import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { join } from "https://deno.land/std@0.200.0/path/mod.ts";

const GEMINI_API_KEY = "AIzaSyA8IEtJhgsH-SSoZ-XrSWbcwj3_9G1ANOk"; // YOUR API KEY
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const conversationHistory = new Map<string, any[]>();

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
    conversationHistory.set(userId, []);

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        const { name, userMsg } = data;
        
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
          socket.send(JSON.stringify({ sender: 'bot', message: botResponse }));
        } else {
          socket.send(JSON.stringify({ sender: 'error', message: 'Gemini API returned an error.' }));
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        socket.send(JSON.stringify({ sender: 'error', message: 'An error occurred processing your message.' }));
      }
    };

    socket.onclose = () => {
      console.log(`Client disconnected: ${userId}`);
      conversationHistory.delete(userId);
    };

    return response;
  }
  
  return new Response("Not Found", { status: 404 });
};

serve(handler, { port: 8000 });
