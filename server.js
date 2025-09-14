const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Your Gemini API Key
const GEMINI_API_KEY = "AIzaSyA8IEtJhgsH-SSoZ-XrSWbcwj3_9G1ANOk";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// In-memory object to store conversation history
const conversationHistory = {};

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', ws => {
    // A simple way to identify users. In a real app, you'd use a unique ID.
    const userId = Date.now().toString(36);
    console.log(`New client connected: ${userId}`);

    // Initialize conversation history for this user
    conversationHistory[userId] = [];

    ws.on('message', async message => {
        try {
            const data = JSON.parse(message);
            const { name, userMsg } = data;

            // Add user's message to their history
            const userMessageForAI = { role: "user", parts: [{ text: `${name}: ${userMsg}` }] };
            conversationHistory[userId].push(userMessageForAI);

            // Construct payload for Gemini API
            const requestBody = {
                contents: conversationHistory[userId]
            };

            const geminiRes = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
            const geminiData = await geminiRes.json();

            if (geminiData.candidates && geminiData.candidates[0]) {
                const botResponse = geminiData.candidates[0].content.parts[0].text;
                
                // Add the AI's response to the conversation history
                conversationHistory[userId].push({ role: "model", parts: [{ text: botResponse }] });

                // Send the AI's response to the client
                ws.send(JSON.stringify({ sender: 'bot', message: botResponse }));
            } else {
                ws.send(JSON.stringify({ sender: 'error', message: 'Gemini API returned an error.' }));
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
            ws.send(JSON.stringify({ sender: 'error', message: 'An error occurred processing your message.' }));
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${userId}`);
        delete conversationHistory[userId];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
