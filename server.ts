import { serve } from "https://deno.land/std@0.200.0/http/server.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const conversationHistory = new Map<string, any[]>();
const clients = new Set<WebSocket>();

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Gemini WebSocket Chat</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: #f0f4f8;
    }
    #chat-box {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .msg {
      max-width: 80%;
      padding: 0.75rem 1rem;
      border-radius: 1.5rem;
      word-wrap: break-word;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
    .user {
      background-color: #2c7;
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 0.5rem;
    }
    .bot {
      background-color: #06c;
      color: #fff;
      align-self: flex-start;
      border-bottom-left-radius: 0.5rem;
    }
    .name-tag {
      font-size: 0.75rem;
      font-weight: bold;
      margin-bottom: 0.25rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #fff;
    }
    #input-form {
      display: flex;
      padding: 1rem;
      background: #fff;
      border-top: 1px solid #ddd;
    }
    #message-input {
      flex: 1;
      padding: 0.75rem 1rem;
      border: 1px solid #ccc;
      border-radius: 2rem;
      outline: none;
    }
    #send-button {
      margin-left: 0.5rem;
      padding: 0.75rem 1.5rem;
      border: none;
      background-color: #06c;
      color: white;
      border-radius: 2rem;
      cursor: pointer;
    }
    #send-button:hover {
      background-color: #0051a8;
    }
  </style>
</head>
<body>
  <div id="chat-box"></div>

  <form id="input-form">
    <input type="text" id="message-input" placeholder="Type your message…" required />
    <button type="submit" id="send-button">Send</button>
  </form>

  <script>
    const chatBox = document.getElementById('chat-box');
    const inputForm = document.getElementById('input-form');
    const messageInput = document.getElementById('message-input');

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(\`\${proto}://\${location.host}\`);

    let userName = "";

    ws.onopen = () => {
      userName = prompt("Please enter your name:") || "Anonymous";
      addMessage(\`Welcome, \${userName}! You can start chatting now.\`, 'bot');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.sender === 'user') {
        addMessage(data.message, 'user', data.name);
      } else if (data.sender === 'bot') {
        addMessage(data.message, 'bot', 'Gemini');
      } else if (data.sender === 'error') {
        addMessage(data.message, 'bot', 'Error');
      }
    };

    inputForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const userMsg = messageInput.value.trim();
      if (userMsg) {
        ws.send(JSON.stringify({ name: userName, userMsg }));
        messageInput.value = '';
      }
    });

    function addMessage(text, sender, name = null) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'msg ' + sender;

      if (sender === 'user' && name) {
        const nameTag = document.createElement('div');
        nameTag.className = 'name-tag';
        nameTag.textContent = name;
        msgDiv.appendChild(nameTag);
      }

      const p = document.createElement('p');
      p.textContent = text;
      msgDiv.appendChild(p);
      chatBox.appendChild(msgDiv);
      chatBox.scrollTop = chatBox.scrollHeight;
    }
  </script>
</body>
</html>`;

serve(async (req) => {
  const { pathname } = new URL(req.url);

  // Handle missing API key
  if (!GEMINI_API_KEY) {
    return new Response("GEMINI_API_KEY not set", { status: 500 });
  }

  if (pathname === "/") {
    return new Response(HTML, { 
      headers: { 
        "Content-Type": "text/html",
        "Access-Control-Allow-Origin": "*"
      } 
    });
  }

  if (req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    const userId = crypto.randomUUID();
    clients.add(socket);
    conversationHistory.set(userId, []);

    socket.onmessage = async (e) => {
      try {
        const { name, userMsg } = JSON.parse(e.data);
        const userMessage = { sender: "user", name, message: userMsg };
        for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(userMessage));

        const history = conversationHistory.get(userId) ?? [];
        history.push({ role: "user", parts: [{ text: `${name}: ${userMsg}` }] });
        conversationHistory.set(userId, history);

        const geminiRes = await fetch(GEMINI_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: history }),
        });
        const geminiData = await geminiRes.json();

        const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          history.push({ role: "model", parts: [{ text }] });
          for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ sender: "bot", name: "Gemini", message: text }));
        }
      } catch (err) {
        socket.send(JSON.stringify({ sender: "error", message: err.message }));
      }
    };

    socket.onclose = () => {
      clients.delete(socket);
      conversationHistory.delete(userId);
    };

    return response;
  }

  return new Response("Not found", { status: 404 });
});
