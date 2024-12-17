import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { useAuth } from "../context/AuthContext";

const Stream = () => {
  const { roomID } = useParams(); // Get room ID from the URL
  const { user, login } = useAuth(); // Get the current user
  const socket = useRef();
  const hostVideo = useRef(); // Host's video reference
  const [isHost, setIsHost] = useState(false); // Determines if the user is the host
  const [msgs, setMsgs] = useState([]); // Chat messages
  const [msgText, setMsgText] = useState(""); // Current chat input
  const peersRef = useRef([]); // Keep track of WebRTC peers

  // Initialize socket and join room
  useEffect(() => {
    socket.current = io.connect("https://connect-backend-2s1a.onrender.com/");
    socket.current.emit("join room", { roomID, user });

    // Check if the current user is the host
    socket.current.on("all users", (users) => {
      if (users.length === 0) {
        // If no users are present, current user becomes the host
        setIsHost(true);
        startHostStream();
      }
    });

    // Handle when a participant joins
    socket.current.on("user joined", ({ signal, callerID }) => {
      if (!isHost) return; // Only the host handles incoming connections
      const peer = createPeer(callerID, signal);
      peersRef.current.push(peer);
    });

    // Handle returned signals from participants
    socket.current.on("receiving returned signal", ({ id, signal }) => {
      const peer = peersRef.current.find((p) => p.callerID === id);
      if (peer) {
        peer.peer.signal(signal);
      }
    });

    // Handle chat messages
    socket.current.on("message", (message) => {
      setMsgs((prev) => [...prev, message]);
    });

    return () => {
      socket.current.disconnect();
    };
  }, [user, roomID, isHost]);

  // Host: Start the video/audio stream
  const startHostStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      hostVideo.current.srcObject = stream;

      // Add stream tracks to WebRTC connections
      stream.getTracks().forEach((track) => {
        peersRef.current.forEach(({ peer }) => {
          peer.addTrack(track, stream);
        });
      });
    } catch (error) {
      console.error("Error starting host stream:", error);
    }
  };

  // Host: Create a WebRTC connection for a participant
  const createPeer = (callerID, incomingSignal) => {
    const peer = new RTCPeerConnection();

    const stream = hostVideo.current.srcObject;
    stream.getTracks().forEach((track) => {
      peer.addTrack(track, stream);
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.current.emit("returning signal", {
          signal: event.candidate,
          callerID,
        });
      }
    };

    peer.signal(incomingSignal);

    return { callerID, peer };
  };

  // Send chat messages
  const sendMessage = (e) => {
    e.preventDefault();
    if (msgText.trim() === "") return;

    const message = {
      roomID,
      user: {
        name: user?.displayName,
        photoURL: user?.photoURL,
      },
      message: msgText.trim(),
    };

    socket.current.emit("send message", message);
    setMsgs((prev) => [...prev, { ...message, self: true }]);
    setMsgText("");
  };

  
};

export default Stream;
