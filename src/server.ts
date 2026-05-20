import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import * as admin from 'firebase-admin';

// 1. Initialize Redis (Updated for Upstash / Render)
// Make sure REDIS_URL in Render is set to your Upstash string (rediss://...)
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redis = new Redis(redisUrl, {
  // These options help keep the Upstash connection stable on serverless/cloud platforms
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: null,
});

redis.on('connect', () => {
  console.log('✅ Successfully connected to Upstash Redis!');
});

redis.on('error', (err) => {
  console.error('❌ Redis Connection Error:', err);
});

// 2. Initialize Firebase Admin (Updated for Render)
if (!admin.apps.length) {
  const base64Credentials = process.env.FIREBASE_CREDENTIALS_BASE64;

  if (base64Credentials) {
    // Uses the Base64 string if you added it to Render Environment Variables
    try {
      const serviceAccount = JSON.parse(
        Buffer.from(base64Credentials, 'base64').toString('utf-8')
      );
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('✅ Firebase initialized using Base64 Environment Variable.');
    } catch (error) {
      console.error('❌ Failed to parse Firebase Base64 credentials:', error);
    }
  } else {
    // Fallback if you used the Render "Secret File" method instead
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
    console.log('✅ Firebase initialized using Default Credentials (Secret File).');
  }
}

/**
 * Attaches the map tracking logic to an existing Socket.IO server instance.
 * @param io The initialized Socket.IO server
 */
export const setupMapSockets = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log(`📡 User connected to map sockets: ${socket.id}`);

    /**
     * 1. Employer joins the map view
     */
    socket.on('joinTask', async (taskId: string) => {
      socket.join(taskId);
      console.log(`👀 Socket ${socket.id} joined task room: ${taskId}`);

      // Instantly retrieve the last known cached location from Redis 
      // so the employer's map doesn't load blank.
      try {
        const cachedLocation = await redis.hgetall(`task_location:${taskId}`);
        if (cachedLocation && cachedLocation.lat && cachedLocation.lng) {
          socket.emit('locationUpdated', {
            lat: parseFloat(cachedLocation.lat),
            lng: parseFloat(cachedLocation.lng),
            timestamp: cachedLocation.timestamp,
          });
          console.log(`📍 Served cached location from Redis for task: ${taskId}`);
        }
      } catch (error) {
        console.error(`❌ Failed to fetch cached location for task ${taskId}:`, error);
      }
    });

    /**
     * 2. Worker presses "Indicate Traveling"
     */
    socket.on('workerTraveling', async (data: any) => {
      const {
        taskId,
        eta,
        message,
        employerFcmToken,
        taskLocation,
        startLat,
        startLng,
      } = data;

      // Broadcast to anyone (employer) currently viewing the map live
      io.to(taskId).emit('workerTraveling', data);

      // Cache the initial starting coordinates
      if (startLat && startLng) {
        const redisKey = `task_location:${taskId}`;
        try {
          await redis.hset(redisKey, {
            lat: startLat.toString(),
            lng: startLng.toString(),
            timestamp: Date.now().toString(),
          });
          await redis.expire(redisKey, 7200); // Expires in 2 hours
        } catch (error) {
          console.error('❌ Redis Caching error on start:', error);
        }
      }

      // Trigger Push Notification so the Employer can tap and open the map
      if (employerFcmToken) {
        const payload = {
          notification: {
            title: 'Worker is on the way!',
            body: `ETA: ${eta}. ${message || 'Tap to view live location.'}`,
          },
          data: {
            type: 'travel', // Triggers the map routing case in flutter
            related_id: taskId.toString(),
            location: JSON.stringify(taskLocation || {}),
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
        };

        try {
          await admin.messaging().send({
            token: employerFcmToken,
            ...payload,
          });
          console.log(`🔔 Sent travel FCM notification to employer for task ${taskId}`);
        } catch (error) {
          console.error('❌ FCM Notification Error:', error);
        }
      }
    });

    /**
     * 3. Worker's GPS streams updates
     */
    socket.on('updateLocation', async (data: any) => {
      const { taskId, lat, lng } = data;

      if (!taskId || lat === undefined || lng === undefined) return;

      // Cache with Redis Hash to ensure seamless reconnects
      const redisKey = `task_location:${taskId}`;
      try {
        await redis.hset(redisKey, {
          lat: lat.toString(),
          lng: lng.toString(),
          timestamp: Date.now().toString(),
        });
        await redis.expire(redisKey, 7200); // Reset the 2-hour expiration
      } catch (error) {
        console.error('❌ Redis update caching error:', error);
      }

      // Broadcast the coordinates to the employer in the room
      io.to(taskId).emit('locationUpdated', { lat, lng });
    });

    socket.on('disconnect', () => {
      console.log(`🔌 User disconnected from map sockets: ${socket.id}`);
    });
  });
};