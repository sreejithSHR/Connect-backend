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

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {user ? (
        <>
          <header className="p-4 bg-gray-800 flex justify-between items-center">
            <h1 className="text-xl">{isHost ? "You are hosting" : "Live Stream"}</h1>
            <button
              className="text-sm bg-blue-500 px-4 py-2 rounded"
              onClick={() => login()}
            >
              Logout
            </button>
          </header>

          <main className="flex flex-grow">
            {/* Video Section */}
            <div className="flex-grow p-4 flex items-center justify-center">
              {isHost ? (
                <video
                  ref={hostVideo}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full bg-black rounded"
                />
              ) : (
                <div className="text-lg">Waiting for the host to start streaming...</div>
              )}
            </div>

            {/* Chat Section */}
            <div className="w-1/3 bg-gray-800 p-4 flex flex-col">
              <div className="flex-grow overflow-y-auto">
                {msgs.map((msg, index) => (
                  <div
                    key={index}
                    className={`flex items-start gap-2 mb-2 text-sm ${
                      msg.self ? "text-right" : ""
                    }`}
                  >
                    {!msg.self && (
                      <img
                        src={msg.user?.photoURL || "https://placehold.co/30x30"}
                        alt={msg.user?.name || "User"}
                        className="h-8 w-8 rounded-full"
                      />
                    )}
                    <div>
                      {!msg.self && <p className="font-bold">{msg.user?.name}</p>}
                      <p>{msg.message}</p>
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={sendMessage} className="mt-2 flex">
                <input
                  type="text"
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
                  className="flex-grow px-4 py-2 rounded bg-gray-700"
                  placeholder="Enter your message..."
                />
                <button
                  type="submit"
                  className="ml-2 px-4 py-2 bg-blue-500 rounded"
                >
                  Send
                </button>
              </form>
            </div>
          </main>
        </>
      ) : (
        <div className="h-screen flex items-center justify-center">
          <button
            className="px-4 py-2 bg-blue-500 text-white rounded"
            onClick={login}
          >
            Login to Join
          </button>
        </div>
      )}
    </div>
  );
};

export default Stream;
