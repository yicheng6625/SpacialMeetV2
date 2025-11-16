package com.spatialmeet;

import com.spatialmeet.model.Player;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class PlayerRegistry {
    private final Map<String, Player> players = new ConcurrentHashMap<>();

    public void addPlayer(Player player) {
        players.put(player.getId(), player);
    }

    public void removePlayer(String id) {
        players.remove(id);
    }

    public Player getPlayer(String id) {
        return players.get(id);
    }

    public Map<String, Player> getAllPlayers() {
        return players;
    }
}