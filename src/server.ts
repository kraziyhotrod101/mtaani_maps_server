import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import * as admin from 'firebase-admin';
import express from 'express';
import http from 'http';
import cors from 'cors';
import 'dotenv/config';

// ==========================================
// 1. App & Server Setup
// ==========================================
const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// ==========================================
// 2. Redis Setup (Upstash / Render)
// ==========================================
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redis = new Redis(redisUrl, {
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: null,
});

redis.on('connect', () => console.log('✅ Successfully connected to Upstash Redis!'));
redis.on('error', (err) => console.error('❌ Redis Connection Error:', err));

// ==========================================
// 3. Firebase Admin Setup
// ==========================================
if (!admin.apps.length) {
  const base64Credentials = process.env.FIREBASE_CREDENTIALS_BASE64;

  if (base64Credentials) {
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
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: 'mtaani-jobs-9f1e4'
    });
    console.log('✅ Firebase initialized using Default Credentials (Secret File).');
  }
}

// ==========================================
// 4. Standalone FCM Test Function
// ==========================================
export const sendTestNotification = async (targetFcmToken: string, chatId: string, senderName: string) => {
  const payload = {
    notification: {
      title: `New message from ${senderName}`,
      body: 'Hey, I am on my way!',
    },
    data: {
      type: 'new_chat_message', 
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
      related_id: chatId,
      metadata: JSON.stringify({
        senderId: "user_789",
        timestamp: new Date().toISOString()
      })
    }
  };

  try {
    await admin.messaging().send({
      ...payload,
      token: targetFcmToken,
    });
    console.log(`🔔 Notification sent successfully to token: ${targetFcmToken}`);
  } catch (error: any) {
    if (
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered'
    ) {
      console.warn(`⚠️ Invalid or expired FCM token detected: ${targetFcmToken}`);
    } else {
      console.error('❌ Failed to send FCM notification:', error);
    }
  }
};

// ==========================================
// 5. Socket.IO Map Tracking Logic
// ==========================================
export const setupMapSockets = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log(`📡 User connected to map sockets: ${socket.id}`);

    // Employer joins the map view
    socket.on('joinTask', async (taskId: string) => {
      socket.join(taskId);
      console.log(`👀 Socket ${socket.id} joined task room: ${taskId}`);

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

    // Worker presses "Indicate Traveling"
    socket.on('workerTraveling', async (data: any) => {
      const { taskId, eta, message, employerFcmToken, taskLocation, startLat, startLng } = data;

      io.to(taskId).emit('workerTraveling', data);

      if (startLat && startLng) {
        const redisKey = `task_location:${taskId}`;
        try {
          await redis.hset(redisKey, {
            lat: startLat.toString(),
            lng: startLng.toString(),
            timestamp: Date.now().toString(),
          });
          await redis.expire(redisKey, 7200); 
        } catch (error) {
          console.error('❌ Redis Caching error on start:', error);
        }
      }

      if (employerFcmToken) {
        const payload = {
          notification: {
            title: 'Worker is on the way!',
            body: `ETA: ${eta}. ${message || 'Tap to view live location.'}`,
          },
          data: {
            type: 'travel',
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

    // Worker's GPS streams updates
    socket.on('updateLocation', async (data: any) => {
      const { taskId, lat, lng } = data;

      if (!taskId || lat === undefined || lng === undefined) return;

      const redisKey = `task_location:${taskId}`;
      try {
        await redis.hset(redisKey, {
          lat: lat.toString(),
          lng: lng.toString(),
          timestamp: Date.now().toString(),
        });
        await redis.expire(redisKey, 7200); 
      } catch (error) {
        console.error('❌ Redis update caching error:', error);
      }

      io.to(taskId).emit('locationUpdated', { lat, lng });
    });

    socket.on('disconnect', () => {
      console.log(`🔌 User disconnected from map sockets: ${socket.id}`);
    });
  });
};

setupMapSockets(io);

// ==========================================
// 6. Test Execution Block
// ==========================================
// Note: Remove or comment this block out before deploying to production!
//const testToken = "fNAYyDQ0RJqJbiBiDdC6Fx:APA91bF_dLpSh2276dc9NGgEMwMdv5NlnH00YmhOfl_ER0A88XKhHgoE8ZyoxJoUAC1re87WhwLwJVyf-rdEoQi6UkmdXNsE4Dv06_raZPzpK0itvOjWIw4";

//sendTestNotification(
  //testToken, 
  //"test_chat_001", 
  //"System Admin"
//).then(() => {
  //console.log("✅ Test execution finished.");
//});

// ==========================================
// 7. Start Server
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});