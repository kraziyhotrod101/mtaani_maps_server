import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);

// Initialize Socket.io
const io = new Server(httpServer, {
    cors: {
        origin: '*', // Restrict this to your front-end domain in production
        methods: ['GET', 'POST']
    }
});

// In-memory store for locations (Use Redis or Postgres in production)
const activeLocations: Record<string, { lat: number; lng: number; label: string }> = {};

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Flutter client joins a room to listen for updates on a specific task
    socket.on('joinTask', (taskId: string) => {
        socket.join(taskId);
        console.log(`Socket ${socket.id} joined task room: ${taskId}`);

        // Send the latest known location immediately upon connecting
        if (activeLocations[taskId]) {
            socket.emit('locationUpdated', activeLocations[taskId]);
        }
    });

    // A worker/driver emits their new location via socket
    socket.on('updateLocation', (data: { taskId: string; lat: number; lng: number; label?: string }) => {
        const payload = {
            lat: data.lat,
            lng: data.lng,
            label: data.label || 'Task location updated'
        };

        // Update state
        activeLocations[data.taskId] = payload;

        // Broadcast to all clients viewing this task map
        io.to(data.taskId).emit('locationUpdated', payload);
        console.log(`Location updated for task ${data.taskId}:`, payload);
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});

// Alternative: A REST endpoint to update location (e.g. from an external webhook)
app.post('/api/tasks/:taskId/location', (req, res) => {
    const { taskId } = req.params;
    const { lat, lng, label } = req.body;

    if (lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'lat and lng are required' });
    }

    const payload = { lat, lng, label: label || 'Updated via API' };
    activeLocations[taskId] = payload;

    // Broadcast update
    io.to(taskId).emit('locationUpdated', payload);

    res.json({ success: true, message: 'Location updated and broadcasted' });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Wiraa Location tracking server running on port ${PORT}`);
});