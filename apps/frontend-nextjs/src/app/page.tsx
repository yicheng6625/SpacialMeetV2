"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

const PhaserGame = dynamic(() => import("@/components/PhaserGame"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-screen">
      Loading game...
    </div>
  ),
});

export default function Home() {
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);

  const handleJoin = () => {
    if (name.trim()) {
      setJoined(true);
    }
  };

  if (!joined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-md">
          <h1 className="text-2xl font-bold mb-4">Welcome to SpatialMeet</h1>
          <input
            type="text"
            placeholder="Enter a display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded mb-4"
            maxLength={30}
          />
          <button
            onClick={handleJoin}
            className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
          >
            Join Office
          </button>
        </div>
      </div>
    );
  }

  return <PhaserGame name={name} />;
}
