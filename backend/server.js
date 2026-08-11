const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  // युजरचा Socket ID क्लायंटला पाठवणे
  socket.emit("me", socket.id);

  socket.on("disconnect", () => {
    socket.broadcast.emit("callEnded");
  });

  // Call पाठवण्यासाठी Event
  socket.on("callUser", (data) => {
    io.to(data.userToCall).emit("callUser", {
      signal: data.signalData,
      from: data.from,
      name: data.name
    });
  });

  // Call स्वीकारण्यासाठी Event
  socket.on("answerCall", (data) => {
    io.to(data.to).emit("callAccepted", data.signal);
  });
  // Whiteboard data broadcast करणे
  socket.on("draw", (data) => {
    socket.broadcast.emit("draw", data);
  });
  // Chat आणि File Sharing Event
  socket.on("send_message", (data) => {
    socket.broadcast.emit("receive_message", data);
  });
});

server.listen(5000, () => {
  console.log("Server 5000 पोर्टवर यशस्वीपणे चालू आहे!");
});