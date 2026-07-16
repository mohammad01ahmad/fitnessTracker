export type Nutrition = {
    food_items: { name: string; quantity: number; unit: string }[]
    calories: number
    protein_g: number
    carbs_g: number
    fat_g: number
    confidence: 'high' | 'medium' | 'low'
    meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack'
}

// plain JSON Schema — OpenRouter is OpenAI-compatible, not Gemini-compatible
const schema = {
    type: "object",
    properties: {
        food_items: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    quantity: { type: "number" },
                    unit: { type: "string" }
                },
                required: ["name", "quantity", "unit"],
                additionalProperties: false
            }
        },
        calories: { type: "number" },
        protein_g: { type: "number" },
        carbs_g: { type: "number" },
        fat_g: { type: "number" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        meal_type: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] }
    },
    required: ["food_items", "calories", "protein_g", "carbs_g", "fat_g", "confidence", "meal_type"],
    additionalProperties: false
}

export async function getNutritionEstimate(mealText: string): Promise<Nutrition> {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: "openai/gpt-oss-20b",
            max_tokens: 1024,
            messages: [
                { role: "system", content: "Role: You are a nutrition estimator. Task: Given a short meal description, estimate calories and macros for the food described and return it in the given schema." },
                { role: "user", content: mealText }
            ],
            response_format: {
                type: "json_schema",
                json_schema: { name: "nutrition", strict: true, schema }
            }
        })
    })

    if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`)

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    // empty when the model hit max_tokens or the provider errored mid-stream
    if (!content) throw new Error(`no content: ${JSON.stringify(data)}`)

    return JSON.parse(content) as Nutrition
}
