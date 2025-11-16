# SpatialMeet

A lightweight, top-down 2D virtual office experience for real-time presence and communication.

## Project Structure

This is a monorepo containing:

- `/apps/frontend-nextjs`: Next.js frontend with Phaser for 2D rendering
- `/apps/backend-springboot`: Spring Boot backend for WebSocket handling
- `/docs`: Project documentation

## Getting Started

### Prerequisites

- Node.js 18+
- Java 17+
- Maven 3.6+

### Setup

1. Clone the repository
2. Install frontend dependencies: `cd apps/frontend-nextjs && npm install`
3. Run the backend: `cd apps/backend-springboot && mvn spring-boot:run`
4. Run the frontend: `cd apps/frontend-nextjs && npm run dev`
