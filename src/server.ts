// src/server.ts
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import dotenv from 'dotenv';
import path from 'path';

import pool, { initializeDatabase } from './db/database';

// Using diff imports names to avoid conflicts
import authRoutes from './routes/auth';
import gamesRoutes from './routes/games';
import chatRoutes from './routes/chat';

import { setupSocketHandlers, broadcastGameList, broadcastGameState } from './socket/socketHandler';

import { attachUser } from './middleware/auth';

dotenv.config();

console.log("DATABASE_URL:", process.env.DATABASE_URL);

const app = express();

app.set('trust proxy', 1); // this is important when behind a proxy like (Heroku/Render/NGINX/etc.)

const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: process.env.NODE_ENV === 'production' ? false : '*',
        credentials: true
    }
});

const PORT = process.env.PORT || 3002;

// store sessions in PostgreSQL
const PgSession = connectPgSimple(session);

// Session configuration
const sessionMiddleware = session({
    store: new PgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: false
    }),
    secret: process.env.SESSION_SECRET || 'coustom-your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // requires HTTPS in production
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7, // can only last for 7 days
        sameSite: 'lax'
    }
});

// using the middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(sessionMiddleware);
app.use(attachUser);

/// ----------------------- Getting the static files ----------------------------------
app.use(express.static(path.join(__dirname, '../public')));
/// --------------------------------------------------------- ///

/// ----------------------- Routing mounts to our APIs ---------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/chat', chatRoutes);

// allow the socket.io engine to use the session middleware
io.engine.use(sessionMiddleware);
/// --------------------------------------------------------- ///


/// -------------------------Setuping Socket.IO handlers and broadcast functions available --------------------------------
setupSocketHandlers(io);

app.set('io', io);
app.set('broadcastGameList', broadcastGameList);
app.set('broadcastGameState', broadcastGameState);
/// --------------------------------------------------------- ///

/// to not cache login page access
function setNoStore(res: express.Response) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
}

// ---------------------------- EDGE CASES: Prevent going to any other page without logging in -----------------------------
app.get('/', (req, res) => {
    if (req.session.userId) {
        return res.sendFile(path.join(__dirname, '../public/lobby.html'));
    } else {
        setNoStore(res); // to not cache login page access
        return res.sendFile(path.join(__dirname, '../public/index.html'));
    }
});

app.get('/lobby', (req, res) => {
    if (!req.session.userId) {
        setNoStore(res);
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, '../public/lobby.html'));
});

app.get('/waiting/:gameId', (req, res) => {
    if (!req.session.userId) {
        setNoStore(res);
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, '../public/waiting.html'));
});

app.get('/games/:gameId', (req, res) => {
    if (!req.session.userId) {
        setNoStore(res);
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, '../public/game.html'));
});

app.get('/results/:gameId', (req, res) => {
    if (!req.session.userId) {
        setNoStore(res);
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, '../public/results.html'));
});
// --------------------------------------------------------- ///

app.get('/error', (_req, res) => {
    res.sendFile(path.join(__dirname, '../public/error.html'));
});


// Error handling middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Initialize database and start server
async function startServer() {
    try {
        // await initializeDatabase();
        console.log("we need to manually run the migrations using npm run migrate:up");
        
        // console.log('Database initialized successfully');

        httpServer.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// the starter function
startServer();


// safely graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal is received: now closing HTTP server');
    httpServer.close(() => {
        console.log('HTTP server now is closed');
        pool.end(() => {
            console.log('Database pool closed');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal is received: now closing HTTP server');
    httpServer.close(() => {
        console.log('HTTP server now is closed');
        pool.end(() => {
            console.log('Database pool closed');
            process.exit(0);
        });
    });
});
