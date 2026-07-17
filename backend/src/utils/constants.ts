// Interface for Nutrition Return
export type Nutrition = {
    food_items: { name: string; quantity: number; unit: string }[]
    calories: number
    protein_g: number
    confidence: 'high' | 'medium' | 'low'
    meal_time: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack'
}

// Insert shape only — id and created_at have DB defaults, and user_id is
// injected by populateTable, so none of them belong here.
export type MealRow = Nutrition & {
    whatsapp_message_id: string
    raw_message_text: string
}
