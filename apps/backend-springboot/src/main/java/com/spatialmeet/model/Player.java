package com.spatialmeet.model;

public class Player {
    private String id;
    private String name;
    private String sprite;
    private int tileX;
    private int tileY;
    private long lastSeen;
    private String inCallWith;

    // Constructors, getters, setters
    public Player() {}

    public Player(String id, String name, int tileX, int tileY) {
        this.id = id;
        this.name = name;
        this.tileX = tileX;
        this.tileY = tileY;
        this.lastSeen = System.currentTimeMillis();
    }

    // Getters and setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getSprite() { return sprite; }
    public void setSprite(String sprite) { this.sprite = sprite; }

    public int getTileX() { return tileX; }
    public void setTileX(int tileX) { this.tileX = tileX; }

    public int getTileY() { return tileY; }
    public void setTileY(int tileY) { this.tileY = tileY; }

    public long getLastSeen() { return lastSeen; }
    public void setLastSeen(long lastSeen) { this.lastSeen = lastSeen; }

    public String getInCallWith() { return inCallWith; }
    public void setInCallWith(String inCallWith) { this.inCallWith = inCallWith; }
}