package com.spatialmeet;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spatialmeet.model.Message;
import com.spatialmeet.model.Player;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Component
public class GameWebSocketHandler extends TextWebSocketHandler {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<String, Player> players = new ConcurrentHashMap<>();
    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private static final String[] AVAILABLE_SPRITES = {"Adam", "Alex", "Amelia", "Bob"};
    private final java.util.Random random = new java.util.Random();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        // Sessions are managed in handleJoin when player joins
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        Message msg = objectMapper.readValue(message.getPayload(), Message.class);
        switch (msg.getType()) {
            case "join":
                handleJoin(session, msg);
                break;
            case "move":
                handleMove(session, msg);
                break;
            case "request_call":
                handleRequestCall(session, msg);
                break;
            case "call_response":
                handleCallResponse(session, msg);
                break;
            case "webrtc_signal":
                handleWebRTCSignal(session, msg);
                break;
            case "call_ended":
                handleCallEnded(session, msg);
                break;
        }
    }

    private void handleJoin(WebSocketSession session, Message msg) throws IOException {
        Map<String, Object> data = (Map<String, Object>) msg.getData();
        String spaceId = (String) data.get("spaceId");
        String token = (String) data.get("token");
        String playerName = (String) data.get("name");
        
        // For now, we only support one space, so ignore spaceId
        // TODO: Add proper space/room management
        
        // Generate a unique player ID (in a real app, validate token and get user ID)
        String playerId = "player_" + System.currentTimeMillis() + "_" + (int)(Math.random() * 1000);
        
        // Create player at spawn position (pixel coordinates)
        int spawnX = 160; // 5 * 32 + 16 (center of tile)
        int spawnY = 160; // 5 * 32 + 16 (center of tile)
        Player player = new Player(playerId, playerName != null ? playerName : "User", spawnX, spawnY);
        
        // Assign random sprite
        String sprite = AVAILABLE_SPRITES[random.nextInt(AVAILABLE_SPRITES.length)];
        player.setSprite(sprite);

        players.put(playerId, player);
        sessions.put(playerId, session);
        
        // Send space-joined response with spawn position and existing users
        List<Map<String, Object>> existingUsers = players.values().stream()
            .filter(p -> !p.getId().equals(playerId))
            .map(p -> {
                Map<String, Object> userData = new HashMap<>();
                userData.put("id", p.getId());
                userData.put("name", p.getName());
                userData.put("sprite", p.getSprite());
                userData.put("x", p.getTileX());
                userData.put("y", p.getTileY());
                return userData;
            })
            .collect(Collectors.toList());
            
        Map<String, Object> responseData = new HashMap<>();
        responseData.put("spawnX", spawnX);
        responseData.put("spawnY", spawnY);
        responseData.put("sprite", sprite);
        responseData.put("existingUsers", existingUsers);
        
        Message response = new Message("space-joined", responseData);
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(response)));
        
        // Broadcast user-join to other players
        Map<String, Object> joinData = new HashMap<>();
        joinData.put("id", playerId);
        joinData.put("name", player.getName());
        joinData.put("sprite", player.getSprite());
        joinData.put("x", spawnX);
        joinData.put("y", spawnY);
        
        Message joined = new Message("user-join", joinData);
        broadcast(joined, session);
    }

    private void handleMove(WebSocketSession session, Message msg) throws IOException {
        // Find player by session
        String playerId = null;
        for (Map.Entry<String, WebSocketSession> entry : sessions.entrySet()) {
            if (entry.getValue().equals(session)) {
                playerId = entry.getKey();
                break;
            }
        }
        
        if (playerId == null) return;
        
        Map<String, Object> data = (Map<String, Object>) msg.getData();
        int targetX = ((Number) data.get("x")).intValue();
        int targetY = ((Number) data.get("y")).intValue();
        String direction = (String) data.get("direction");
        
        Player player = players.get(playerId);
        if (player == null) return;
        
        // Validate movement (pixel-based bounds and collision check)
        boolean isValidMove = validateMovement(targetX, targetY, playerId);
        
        if (isValidMove) {
            // Update player position (store as pixels)
            player.setTileX(targetX);
            player.setTileY(targetY);
            player.setLastSeen(System.currentTimeMillis());
            
            // Broadcast movement to all clients
            Map<String, Object> movementData = new HashMap<>();
            movementData.put("id", playerId);
            movementData.put("x", targetX);
            movementData.put("y", targetY);
            movementData.put("direction", direction);
            
            Message movement = new Message("movement", movementData);
            broadcast(movement, null);
        } else {
            // Send movement rejection with corrected position
            Map<String, Object> rejectionData = new HashMap<>();
            rejectionData.put("x", player.getTileX());
            rejectionData.put("y", player.getTileY());
            
            Message rejection = new Message("movement-rejected", rejectionData);
            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(rejection)));
        }
    }
    
    private boolean validateMovement(int x, int y, String playerId) {
        // Basic bounds check (1760x800 pixel area, with 16px padding for player radius)
        if (x < 16 || x >= 1760 - 16 || y < 16 || y >= 800 - 16) {
            return false;
        }
        
        // Check for wall collision (edges of the map)
        // For pixel-based movement, walls are at the edges
        if (x <= 32 || x >= 1760 - 32 || y <= 32 || y >= 800 - 32) {
            return false;
        }
        
        // Check for collision with other players (32px radius around each player)
        for (Player other : players.values()) {
            if (!other.getId().equals(playerId)) {
                int dx = x - other.getTileX();
                int dy = y - other.getTileY();
                double distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < 32) { // 32px minimum distance (16px radius * 2)
                    return false;
                }
            }
        }
        
        return true;
    }

    private void handleRequestCall(WebSocketSession session, Message msg) throws IOException {
        Map<String, Object> data = (Map<String, Object>) msg.getData();
        String from = (String) data.get("from");
        String to = (String) data.get("to");
        String callType = (String) data.get("callType");

        Player fromPlayer = players.get(from);
        if (fromPlayer != null && players.containsKey(to)) {
            // Relay incoming_call to target
            Message incoming = new Message("incoming_call", Map.of("from", from, "fromName", fromPlayer.getName(), "callType", callType));
            WebSocketSession toSession = sessions.get(to);
            if (toSession != null) {
                toSession.sendMessage(new TextMessage(objectMapper.writeValueAsString(incoming)));
            }
        }
    }

    private void handleCallResponse(WebSocketSession session, Message msg) throws IOException {
        Map<String, Object> data = (Map<String, Object>) msg.getData();
        String from = (String) data.get("from");
        String to = (String) data.get("to");
        boolean accepted = (Boolean) data.get("accepted");

        // Relay to caller
        Message response = new Message("call_response", Map.of("from", from, "to", to, "accepted", accepted));
        WebSocketSession fromSession = sessions.get(from);
        if (fromSession != null) {
            fromSession.sendMessage(new TextMessage(objectMapper.writeValueAsString(response)));
        }
    }

    private void handleWebRTCSignal(WebSocketSession session, Message msg) throws IOException {
        Map<String, Object> data = (Map<String, Object>) msg.getData();
        String from = (String) data.get("from");
        String to = (String) data.get("to");
        Object signalData = data.get("data");

        // Relay signal
        Message signal = new Message("webrtc_signal", Map.of("from", from, "to", to, "data", signalData));
        WebSocketSession toSession = sessions.get(to);
        if (toSession != null) {
            toSession.sendMessage(new TextMessage(objectMapper.writeValueAsString(signal)));
        }
    }

    private void handleCallEnded(WebSocketSession session, Message msg) throws IOException {
        Map<String, Object> data = (Map<String, Object>) msg.getData();
        String from = (String) data.get("from");
        String to = (String) data.get("to");
        String reason = (String) data.get("reason");

        // Relay to both
        Message ended = new Message("call_ended", Map.of("from", from, "to", to, "reason", reason));
        broadcast(ended, null);
    }

    private void broadcast(Message msg, WebSocketSession exclude) throws IOException {
        String json = objectMapper.writeValueAsString(msg);
        
        // Clean up closed sessions first
        sessions.entrySet().removeIf(entry -> !entry.getValue().isOpen());
        
        for (WebSocketSession s : sessions.values()) {
            if (exclude == null || !s.equals(exclude)) {
                try {
                    s.sendMessage(new TextMessage(json));
                } catch (Exception e) {
                    // Session might have been closed during iteration
                    System.err.println("Failed to send message to session: " + e.getMessage());
                }
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, org.springframework.web.socket.CloseStatus status) throws Exception {
        // Find player by session
        String playerId = null;
        for (Map.Entry<String, WebSocketSession> entry : sessions.entrySet()) {
            if (entry.getValue().equals(session)) {
                playerId = entry.getKey();
                break;
            }
        }
        
        if (playerId != null) {
            players.remove(playerId);
            sessions.remove(playerId);
            
            // Broadcast user-left to remaining players
            Map<String, Object> leftData = new HashMap<>();
            leftData.put("id", playerId);
            
            Message left = new Message("user-left", leftData);
            broadcast(left, null);
        }
    }
}