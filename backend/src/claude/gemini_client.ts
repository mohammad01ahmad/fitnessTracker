import { GoogleGenAI, Type } from '@google/genai';
import type { Nutrition } from './openrouter_client.ts';

const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

export async function getNutritionEstimate(mealText: string): Promise<Nutrition> {
    const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: mealText,
        config: {
            systemInstruction: "Role: You are a nutrition estimator. Task: Given a short meal description, estimate calories and macros for the food described and return it in the given responseSchema.",
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    food_items: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                quantity: { type: Type.NUMBER },
                                unit: { type: Type.STRING }
                            },
                            required: ["name", "quantity", "unit"]
                        }
                    },
                    calories: { type: Type.NUMBER },
                    protein_g: { type: Type.NUMBER },
                    carbs_g: { type: Type.NUMBER },
                    fat_g: { type: Type.NUMBER },
                    confidence: { type: Type.STRING, enum: ["high", "medium", "low"] },
                    meal_type: { type: Type.STRING, enum: ["breakfast", "lunch", "dinner", "snack"] },
                },
                required: ["food_items", "calories", "protein_g", "carbs_g", "fat_g", "confidence", "meal_type"]
            }
        }
    });

    // empty when the model hit maxOutputTokens or was blocked — JSON.parse would throw a useless error
    if (!response.text) throw new Error(`no text in Gemini response: ${response.candidates?.[0]?.finishReason}`)

    return JSON.parse(response.text) as Nutrition
}
