import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { join } from "https://deno.land/std@0.200.0/path/mod.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const conversationHistory = new Map<string, any[]>();
const clients = new Set<WebSocket>();

const serveHtml = async (request: Request) => {
  const filePath = join(Deno.cwd(), "index.html");
  try {
    const file = await Deno.readFile(filePath);
    return new Response(file, { headers: { "Content-Type": "text/html" } });
  } catch (error) {
    return new Response("File not found", { status: 404 });
  }
};

const handler = async (request: Request): Promise<Response> => {
  const { pathname } = new URL(request.url);

  if (pathname === "/") {
    return serveHtml(request);
  }

  if (request.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(request);
    const userId = crypto.randomUUID();

    console.log(`New client connected: ${userId}`);
    clients.add(socket);
    conversationHistory.set(userId, []);

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        const { name, userMsg } = data;
        
        // Broadcast the user's message to all clients
        const userMessage = { sender: 'user', name: name, message: userMsg };
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(userMessage));
          }
        }
        
        const userMessageForAI = { role: "user", parts: [{ text: `${name}: ${userMsg}` }] };
        const history = conversationHistory.get(userId) || [];
        history.push(userMessageForAI);
        conversationHistory.set(userId, history);

        const requestBody = {
          contents: history
        };

        const geminiRes = await fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        const geminiData = await geminiRes.json();
        
        if (geminiData.candidates && geminiData.candidates[0]) {
          const botResponse = geminiData.candidates[0].content.parts[0].text;
          conversationHistory.get(userId)?.push({ role: "model", parts: [{ text: botResponse }] });

          // Broadcast the AI's response to all clients
          const aiMessage = { sender: 'bot', name: 'Gemini', message: botResponse };
          for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(aiMessage));
            }
          }
        } else {
          const errorMessage = { sender: 'error', message: 'Gemini API returned an error.' };
          socket.send(JSON.stringify(errorMessage));
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        const errorMessage = { sender: 'error', message: 'An error occurred processing your message.' };
        socket.send(JSON.stringify(errorMessage));
      }
    };

    socket.onclose = () => {
      console.log(`Client disconnected: ${userId}`);
      clients.delete(socket);
      conversationHistory.delete(userId);
    };

    return response;
  }
  
  return new Response("Not Found", { status: 404 });
};

serve(handler, { port: 8000 });
