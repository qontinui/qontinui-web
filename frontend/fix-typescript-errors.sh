#!/bin/bash
# Fix TypeScript errors in services directory

cd "$(dirname "$0")"

# Fix websocket-collaboration-service.ts - add WebSocketMessageType import and fix type assertions
sed -i '12,22s/} from "@\/types\/collaboration";/  WebSocketMessageType,\n} from "@\/types\/collaboration";/' src/services/websocket-collaboration-service.ts
sed -i 's/type: "sync_state" as unknown/type: "sync_state" as WebSocketMessageType/g' src/services/websocket-collaboration-service.ts
sed -i 's/type: "ack" as unknown/type: "ack" as WebSocketMessageType/g' src/services/websocket-collaboration-service.ts
sed -i 's/type: "resend" as unknown/type: "resend" as WebSocketMessageType/g' src/services/websocket-collaboration-service.ts
sed -i 's/message\.data?\.count/(\(message.data as { count?: number } | undefined\))?.count/g' src/services/websocket-collaboration-service.ts
sed -i 's/this\.handlers\.onCursorMove?.\(msg\.data\)/this.handlers.onCursorMove?.(msg.data as CursorMoveMessage)/g' src/services/websocket-collaboration-service.ts
sed -i 's/this\.handlers\.onLockAcquired?.\(msg\.data\)/this.handlers.onLockAcquired?.(msg.data as Lock)/g' src/services/websocket-collaboration-service.ts
sed -i 's/this\.handlers\.onLockReleased?.\(msg\.data\)/this.handlers.onLockReleased?.(msg.data as Lock)/g' src/services/websocket-collaboration-service.ts
sed -i 's/this\.handlers\.onCommentAdded?.\(msg\.data\)/this.handlers.onCommentAdded?.(msg.data as Comment)/g' src/services/websocket-collaboration-service.ts
sed -i 's/this\.handlers\.onCommentUpdated?.\(msg\.data\)/this.handlers.onCommentUpdated?.(msg.data as Comment)/g' src/services/websocket-collaboration-service.ts
sed -i 's/this\.handlers\.onActivityUpdate?.\(msg\.data\)/this.handlers.onActivityUpdate?.(msg.data as Activity)/g' src/services/websocket-collaboration-service.ts

echo "Fixed websocket-collaboration-service.ts"
