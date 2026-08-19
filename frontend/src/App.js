import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import CryptoJS from "crypto-js";

// Connection & Security Config
const socket = io.connect("http://localhost:5000");
const SECRET_KEY = "my-secret-key-123"; // AES Encryption साठी वापरलेली Key

function App() {
  // Authentication States
  const [username, setUsername] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Core App States
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [me, setMe] = useState("");
  const [stream, setStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [receivingCall, setReceivingCall] = useState(false);
  const [caller, setCaller] = useState("");
  const [callerName, setCallerName] = useState("");
  const [callerSignal, setCallerSignal] = useState(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const [idToCall, setIdToCall] = useState("");
  const [callEnded, setCallEnded] = useState(false);

  // Video & WebRTC Refs
  const myVideo = useRef(null);
  const userVideo = useRef(null);
  const connectionRef = useRef(null);

  // Whiteboard Canvas Refs
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);

  useEffect(() => {
    // 1. Socket ID मिळवणे
    if (socket.id) {
      setMe(socket.id);
    }
    socket.on("connect", () => {
      setMe(socket.id);
    });
    socket.on("me", (id) => setMe(id));

    // 2. Camera Stream सुरू करणे (Device in use सुरक्षित हाताळणी)
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((currentStream) => {
        setStream(currentStream);
      })
      .catch((err) => {
        console.warn("Webcam access failed (कॅमेरा उपलब्ध नाही किंवा ब्लॉक आहे):", err);
        navigator.mediaDevices
          .getUserMedia({ video: false, audio: true })
          .then((audioStream) => {
            setStream(audioStream);
          })
          .catch((e) => console.log("Audio also blocked:", e));
      });

    // 3. Incoming Call Listener
    socket.on("callUser", (data) => {
      setReceivingCall(true);
      setCaller(data.from);
      setCallerName(data.name || "User");
      setCallerSignal(data.signal);
    });

    // 4. Whiteboard Drawing Listener
    socket.off("draw").on("draw", (data) => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#e54646";

        if (data.isStart) {
          ctx.beginPath();
          ctx.moveTo(data.x, data.y);
        } else {
          ctx.lineTo(data.x, data.y);
          ctx.stroke();
        }
      }
    });

    // 5. Chat & File Sharing Listener
    socket.off("receive_message").on("receive_message", (data) => {
      if (!data.isFile && data.text) {
        try {
          const bytes = CryptoJS.AES.decrypt(data.text, SECRET_KEY);
          const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
          if (decryptedText) {
            data.text = decryptedText;
          }
        } catch (e) {
          console.error("Decryption error:", e);
        }
      }
      setMessages((prev) => [...prev, data]);
    });
  }, []);

  // Login Submit Handler
  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) {
      setIsLoggedIn(true);
    }
  };

  // 1. Call User Function
  const callUser = (id) => {
    if (!id) return;
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream: stream || undefined,
    });

    peer.on("signal", (data) => {
      socket.emit("callUser", {
        userToCall: id,
        signalData: data,
        from: me,
        name: username,
      });
    });

    peer.on("stream", (incomingStream) => {
      setRemoteStream(incomingStream);
    });

    socket.off("callAccepted").on("callAccepted", (signal) => {
      setCallAccepted(true);
      peer.signal(signal);
    });

    connectionRef.current = peer;
  };

  // 2. Answer Call Function
  const answerCall = () => {
    setCallAccepted(true);
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream: stream || undefined,
    });

    peer.on("signal", (data) => {
      socket.emit("answerCall", { signal: data, to: caller });
    });

    peer.on("stream", (incomingStream) => {
      setRemoteStream(incomingStream);
    });

    if (callerSignal) {
      peer.signal(callerSignal);
    }

    connectionRef.current = peer;
  };

  // 3. Screen Sharing Feature
  const shareScreen = () => {
    navigator.mediaDevices
      .getDisplayMedia({ cursor: true })
      .then((screenStream) => {
        const screenTrack = screenStream.getVideoTracks()[0];

        if (
          connectionRef.current &&
          stream &&
          stream.getVideoTracks().length > 0
        ) {
          const videoTrack = stream.getVideoTracks()[0];
          try {
            connectionRef.current.replaceTrack(videoTrack, screenTrack, stream);
          } catch (err) {
            console.warn("Track replace error:", err);
          }
        }
        setStream(screenStream);

        screenTrack.onended = () => {
          navigator.mediaDevices
            .getUserMedia({ video: true, audio: true })
            .then((webcamStream) => {
              if (
                connectionRef.current &&
                webcamStream.getVideoTracks().length > 0
              ) {
                const videoTrack = webcamStream.getVideoTracks()[0];
                try {
                  connectionRef.current.replaceTrack(screenTrack, videoTrack, webcamStream);
                } catch (err) {
                  console.warn("Track revert error:", err);
                }
              }
              setStream(webcamStream);
            })
            .catch((e) => console.log("Webcam restore error:", e));
        };
      })
      .catch((err) => {
        console.log("Screen share cancelled:", err);
      });
  };

  // 4. Whiteboard Functions
  const startDrawing = (e) => {
    isDrawing.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x, y);

    socket.emit("draw", { x, y, isStart: true });
  };

  const stopDrawing = () => {
    isDrawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.beginPath();
    }
  };

  const draw = (e) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    drawOnCanvas(x, y, true);
    socket.emit("draw", { x, y, isStart: false });
  };

  const drawOnCanvas = (x, y, isLocal) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = isLocal ? "#2563eb" : "#4f46e5";

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  // 5. Chat & File Sharing Functions
  const sendMessage = () => {
    if (message.trim()) {
      const encryptedMsg = CryptoJS.AES.encrypt(message, SECRET_KEY).toString();
      const msgData = { text: encryptedMsg, senderName: username, isFile: false };
      socket.emit("send_message", msgData);

      setMessages((prev) => [...prev, { text: message, senderName: username, isMe: true, isFile: false }]);
      setMessage("");
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        const fileData = {
          fileName: file.name,
          fileType: file.type,
          fileData: reader.result,
          senderName: username,
          isFile: true,
        };
        socket.emit("send_message", fileData);
        setMessages((prev) => [...prev, { ...fileData, isMe: true }]);
      };
      reader.readAsDataURL(file);
    }
  };

  // --- USER AUTHENTICATION UI ---
  if (!isLoggedIn) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          fontFamily: "'Segoe UI', Roboto, sans-serif",
          padding: "20px",
        }}
      >
        <form
          onSubmit={handleLogin}
          style={{
            background: "#ffffff",
            padding: "40px",
            borderRadius: "16px",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)",
            width: "100%",
            maxWidth: "400px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: "56px",
              height: "56px",
              background: "#e0e7ff",
              color: "#4f46e5",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              fontSize: "24px",
            }}
          >
            📹
          </div>
          <h2 style={{ margin: "0 0 8px 0", color: "#0f172a", fontSize: "24px", fontWeight: "700" }}>
            Real-Time Communication App
          </h2>
          <p style={{ color: "#64748b", fontSize: "14px", margin: "0 0 24px 0" }}>
            Real-Time Communication & Collaboration Hub
          </p>
          <input
            type="text"
            placeholder="Enter your username / नाव टाका..."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            style={{
              width: "100%",
              padding: "12px 16px",
              marginBottom: "16px",
              borderRadius: "8px",
              border: "1.5px solid #cbd5e1",
              fontSize: "15px",
              boxSizing: "border-box",
              outline: "none",
              transition: "border 0.2s",
            }}
          />
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "12px",
              background: "#4f46e5",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "16px",
              fontWeight: "600",
              boxShadow: "0 4px 6px -1px rgba(79, 70, 229, 0.4)",
              transition: "background 0.2s",
            }}
          >
            Join Room / Login
          </button>
        </form>
      </div>
    );
  }

  // --- MAIN APP UI ---
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        fontFamily: "'Segoe UI', Roboto, sans-serif",
        color: "#1e293b",
        padding: "24px 16px",
      }}
    >
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        
        {/* Header Bar */}
        <div
          style={{
            background: "#ffffff",
            padding: "20px 24px",
            borderRadius: "14px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "24px",
            border: "1px solid #e2e8f0",
          }}
        >
          <div>
            <h2 style={{ margin: "0 0 4px 0", color: "#0f172a", fontSize: "22px", fontWeight: "700" }}>
              Real-Time Communication App
            </h2>
            <span style={{ fontSize: "14px", color: "#64748b" }}>
              Welcome, <b style={{ color: "#0f172a" }}>{username}</b>
            </span>
          </div>

          <div
            style={{
              background: "#f1f5f9",
              padding: "8px 14px",
              borderRadius: "8px",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              border: "1px solid #cbd5e1",
            }}
          >
            <span style={{ color: "#64748b", fontWeight: "500" }}>Your ID:</span>
            <code style={{ color: "#4f46e5", fontWeight: "700" }}>{me || "Connecting..."}</code>
          </div>
        </div>

        {/* Incoming Call Notification Banner */}
        {receivingCall && !callAccepted && (
          <div
            style={{
              background: "#ecfdf5",
              border: "1.5px solid #10b981",
              padding: "16px 20px",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "24px",
              boxShadow: "0 4px 6px -1px rgba(16, 185, 129, 0.15)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>📞</span>
              <span style={{ fontSize: "15px", color: "#065f46", fontWeight: "600" }}>
                {callerName} is calling you...
              </span>
            </div>
            <button
              onClick={answerCall}
              style={{
                padding: "10px 20px",
                background: "#10b981",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: "14px",
                boxShadow: "0 2px 4px rgba(16, 185, 129, 0.3)",
              }}
            >
              Answer Call
            </button>
          </div>
        )}

        {/* Video Feeds Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "20px",
            marginBottom: "24px",
          }}
        >
          {/* Local User Video */}
          <div
            style={{
              background: "#ffffff",
              padding: "16px",
              borderRadius: "14px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              textAlign: "center",
            }}
          >
            <h4 style={{ margin: "0 0 12px 0", color: "#334155", fontSize: "15px" }}>
              You ({username})
            </h4>
            {stream ? (
              <video
                playsInline
                muted
                ref={(node) => {
                  myVideo.current = node;
                  if (node && stream && node.srcObject !== stream) {
                    node.srcObject = stream;
                  }
                }}
                autoPlay
                style={{
                  width: "100%",
                  height: "230px",
                  objectFit: "cover",
                  borderRadius: "10px",
                  background: "#000",
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "230px",
                  background: "#f1f5f9",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#94a3b8",
                  fontSize: "14px",
                }}
              >
                Camera Off / Unavailable
              </div>
            )}
          </div>

          {/* Remote User Video */}
          <div
            style={{
              background: "#ffffff",
              padding: "16px",
              borderRadius: "14px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              textAlign: "center",
            }}
          >
            <h4 style={{ margin: "0 0 12px 0", color: "#334155", fontSize: "15px" }}>
              Remote Participant
            </h4>
            {callAccepted && !callEnded && remoteStream ? (
              <video
                playsInline
                ref={(node) => {
                  userVideo.current = node;
                  if (node && remoteStream && node.srcObject !== remoteStream) {
                    node.srcObject = remoteStream;
                  }
                }}
                autoPlay
                style={{
                  width: "100%",
                  height: "230px",
                  objectFit: "cover",
                  borderRadius: "10px",
                  background: "#000",
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "230px",
                  background: "#f1f5f9",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#94a3b8",
                  fontSize: "14px",
                }}
              >
                {callAccepted ? "Loading Video Stream..." : "No active call"}
              </div>
            )}
          </div>
        </div>

        {/* Controls Section */}
        <div
          style={{
            background: "#ffffff",
            padding: "16px 20px",
            borderRadius: "14px",
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "24px",
          }}
        >
          <input
            type="text"
            placeholder="Enter User ID to Call..."
            value={idToCall}
            onChange={(e) => setIdToCall(e.target.value)}
            style={{
              padding: "10px 14px",
              borderRadius: "8px",
              border: "1.5px solid #cbd5e1",
              fontSize: "14px",
              width: "260px",
              outline: "none",
            }}
          />
          <button
            onClick={() => callUser(idToCall)}
            style={{
              padding: "10px 20px",
              background: "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "600",
              fontSize: "14px",
              boxShadow: "0 2px 4px rgba(37, 99, 235, 0.3)",
            }}
          >
            Start Call
          </button>
          <button
            onClick={shareScreen}
            style={{
              padding: "10px 20px",
              background: "#0d9488",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "600",
              fontSize: "14px",
              boxShadow: "0 2px 4px rgba(13, 148, 136, 0.3)",
            }}
          >
            Share Screen
          </button>
        </div>

        {/* Collaborative Whiteboard */}
        <div
          style={{
            background: "#ffffff",
            padding: "20px",
            borderRadius: "14px",
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            marginBottom: "24px",
            textAlign: "center",
          }}
        >
          <h3 style={{ margin: "0 0 16px 0", color: "#0f172a", fontSize: "17px", fontWeight: "600" }}>
            Real-Time Collaborative Whiteboard
          </h3>
          <div style={{ display: "inline-block", maxWidth: "100%", overflowX: "auto" }}>
            <canvas
              ref={canvasRef}
              width={750}
              height={320}
              onMouseDown={startDrawing}
              onMouseUp={stopDrawing}
              onMouseMove={draw}
              style={{
                border: "2px solid #cbd5e1",
                borderRadius: "10px",
                backgroundColor: "#ffffff",
                cursor: "crosshair",
                display: "block",
              }}
            />
          </div>
        </div>

        {/* Chat & File Sharing */}
        <div
          style={{
            background: "#ffffff",
            padding: "20px",
            borderRadius: "14px",
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <h3 style={{ margin: 0, color: "#0f172a", fontSize: "17px", fontWeight: "600" }}>
              Encrypted Chat & File Sharing
            </h3>
            <span
              style={{
                fontSize: "12px",
                background: "#f0fdf4",
                color: "#166534",
                padding: "4px 10px",
                borderRadius: "20px",
                border: "1px solid #bbf7d0",
                fontWeight: "500",
              }}
            >
              🔒 AES-256 Encrypted
            </span>
          </div>

          <div
            style={{
              height: "220px",
              overflowY: "auto",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              padding: "14px",
              marginBottom: "16px",
            }}
          >
            {messages.map((msg, index) => (
              <div
                key={index}
                style={{
                  display: "flex",
                  justifyContent: msg.isMe ? "flex-end" : "flex-start",
                  marginBottom: "10px",
                }}
              >
                <div
                  style={{
                    maxWidth: "70%",
                    background: msg.isMe ? "#4f46e5" : "#ffffff",
                    color: msg.isMe ? "#ffffff" : "#1e293b",
                    padding: "10px 14px",
                    borderRadius: msg.isMe ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    border: msg.isMe ? "none" : "1px solid #e2e8f0",
                    wordBreak: "break-word",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      color: msg.isMe ? "#c7d2fe" : "#64748b",
                      marginBottom: "4px",
                      fontWeight: "600",
                    }}
                  >
                    {msg.isMe ? "You" : msg.senderName || "User"}
                  </div>

                  {msg.isFile ? (
                    <a
                      href={msg.fileData}
                      download={msg.fileName}
                      style={{
                        color: msg.isMe ? "#ffffff" : "#2563eb",
                        fontWeight: "600",
                        textDecoration: "underline",
                        fontSize: "13px",
                      }}
                    >
                      📎 Download {msg.fileName}
                    </a>
                  ) : (
                    <div style={{ fontSize: "14px" }}>{msg.text}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              placeholder="Type your message..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              style={{
                flex: "1 1 200px",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1.5px solid #cbd5e1",
                fontSize: "14px",
                outline: "none",
              }}
            />
            <button
              onClick={sendMessage}
              style={{
                padding: "10px 20px",
                background: "#4f46e5",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: "14px",
              }}
            >
              Send
            </button>
            <label
              style={{
                padding: "9px 16px",
                background: "#f1f5f9",
                border: "1.5px solid #cbd5e1",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: "600",
                color: "#475569",
              }}
            >
              📎 Attach File
              <input type="file" onChange={handleFileUpload} style={{ display: "none" }} />
            </label>
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;