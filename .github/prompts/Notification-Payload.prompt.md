---
description: "Prompt to scaffold a standardized FCM notification payload with both notification and data payloads."
---
# Create Firebase Notification Payload

Generate a structured Firebase Cloud Messaging (FCM) payload object for a new notification event. Ensure the payload follows our standard pattern with both user-visible alerts and background app data routing.

Please provide the payload structure for the following event:
**Event Description / Type:** {Event Type e.g., "New Chat Message", "Order Assigned"}

### Requirements:
1. **Notification Object:** Include `title` and `body`.
2. **Data Object:** Include a `type` field (for Flutter/frontend route handling), `click_action: 'FLUTTER_NOTIFICATION_CLICK'`, and any relevant IDs (like `related_id`, `task_id`). Stringify any nested objects.
3. Include the boilerplate for `admin.messaging().send({...payload, token: targetFcmToken})`.
4. Wrap the send call in a try/catch block that intercepts invalid token errors so they can be marked for removal.