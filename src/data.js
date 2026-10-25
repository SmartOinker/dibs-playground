// Frozen. In-memory demo data; restarting the server resets it.
export const users = [
  { id: "u1", name: "Alice", email: "alice@example.com", password: "alice" },
  { id: "u2", name: "Bob", email: "bob@example.com", password: "bob" },
];

export const events = [
  { id: "e1", title: "Hackathon kickoff", date: "2026-10-26" },
  { id: "e2", title: "Demo day", date: "2026-10-27" },
];

// The events module decides what a registration row looks like.
export const registrations = [];
