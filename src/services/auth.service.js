const bcrypt = require("bcryptjs");
const createError = require("http-errors");
const { OAuth2Client } = require("google-auth-library");
const prisma = require("../db/prisma");
const env = require("../config/env");
const { sign } = require("../auth/tokens");

const BCRYPT_ROUNDS = 12;
// Compared against when the email doesn't exist, so a miss takes as long as a
// wrong password (no timing hint about which emails have accounts).
const DUMMY_HASH = bcrypt.hashSync("connect-timing-equaliser", BCRYPT_ROUNDS);

const googleClient = env.googleClientId ? new OAuth2Client(env.googleClientId) : null;

// What the client sees. Field names match what the UI already reads.
const publicUser = (user) => ({
  uid: user.id,
  email: user.email,
  displayName: user.name,
  photoURL: user.photoURL,
});

const session = (user) => ({ token: sign(user), user: publicUser(user) });

const authService = {
  publicUser,

  async register({ email, password, name }) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw createError(409, "An account with this email already exists");
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await prisma.user.create({ data: { email, name, passwordHash } });
    return session(user);
  },

  async login({ email, password }) {
    const user = await prisma.user.findUnique({ where: { email } });
    const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
    if (!user?.passwordHash || !ok) throw createError(401, "Wrong email or password");
    return session(user);
  },

  // `credential` is the ID token from Google Identity Services on the client.
  async google({ credential }) {
    if (!googleClient) throw createError(404, "Google sign-in is not configured");
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: env.googleClientId,
      });
      payload = ticket.getPayload();
    } catch (err) {
      throw createError(401, "Google sign-in failed");
    }
    if (!payload?.sub) throw createError(401, "Google sign-in failed");
    if (!payload.email_verified) throw createError(401, "Your Google email isn't verified");

    const email = payload.email.toLowerCase();
    let user = await prisma.user.findUnique({ where: { googleId: payload.sub } });
    if (!user) {
      // Same verified email as a password account -> link them.
      const byEmail = await prisma.user.findUnique({ where: { email } });
      user = byEmail
        ? await prisma.user.update({
            where: { id: byEmail.id },
            data: { googleId: payload.sub, photoURL: byEmail.photoURL || payload.picture || null },
          })
        : await prisma.user.create({
            data: {
              email,
              googleId: payload.sub,
              name: payload.name || email.split("@")[0],
              photoURL: payload.picture || null,
            },
          });
    }
    return session(user);
  },
};

module.exports = authService;
