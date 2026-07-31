import { GoogleGenAI } from "@google/genai";
import fs from 'fs';
import path from 'path';

function loadEnv() {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const parts = trimmed.split('=');
                const key = parts[0].trim();
                const val = parts.slice(1).join('=').trim();
                if (key && !process.env[key]) {
                    process.env[key] = val;
                }
            }
        });
    }
}

loadEnv();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
    try {
        console.log("Testing call to gemini-flash-latest...");
        const response = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: "Olá",
        });
        console.log("Response:", response.text);
    } catch (e) {
        console.error("Error with gemini-flash-latest:", e);
    }

    try {
        console.log("\nTesting call to gemini-2.5-flash...");
        const response2 = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: "Olá",
        });
        console.log("Response 2:", response2.text);
    } catch (e) {
        console.error("Error with gemini-2.5-flash:", e);
    }
}

run();
