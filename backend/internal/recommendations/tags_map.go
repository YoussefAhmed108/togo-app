package recommendations

// GoogleQuery holds what we send to the Google Places Nearby Search API for a
// given interest category.
type GoogleQuery struct {
	Type    string // e.g. "restaurant", "cafe"
	Keyword string // optional extra keyword for sharper results
}

// CategoryMap maps a user-facing interest category slug to a Google Places query.
var CategoryMap = map[string]GoogleQuery{
	"food":          {Type: "restaurant"},
	"coffee":        {Type: "cafe"},
	"outdoors":      {Type: "park"},
	"arts":          {Type: "museum"},
	"shopping":      {Type: "shopping_mall"},
	"nightlife":     {Type: "bar"},
	"wellness":      {Type: "spa"},
	"entertainment": {Type: "movie_theater"},
}

// TagToCategory maps common place tag strings to one of the interest category
// slugs above. Used to derive a taste profile from a user's existing tags when
// they skipped the interest picker.
var TagToCategory = map[string]string{
	// food
	"restaurant": "food", "food": "food", "sushi": "food",
	"ramen": "food", "pizza": "food", "burger": "food",
	"italian": "food", "thai": "food", "chinese": "food",
	"japanese": "food", "korean": "food", "mexican": "food",
	"seafood": "food", "steak": "food", "bbq": "food",
	"brunch": "food", "breakfast": "food", "lunch": "food", "dinner": "food",
	// coffee
	"cafe": "coffee", "coffee": "coffee", "bakery": "coffee",
	"pastry": "coffee", "tea": "coffee",
	// outdoors
	"park": "outdoors", "nature": "outdoors", "hiking": "outdoors",
	"beach": "outdoors", "garden": "outdoors", "trail": "outdoors",
	"outdoor": "outdoors", "camping": "outdoors", "mountain": "outdoors",
	// arts
	"museum": "arts", "art": "arts", "gallery": "arts",
	"culture": "arts", "history": "arts", "exhibition": "arts",
	// shopping
	"shopping": "shopping", "mall": "shopping", "market": "shopping",
	"store": "shopping", "boutique": "shopping",
	// nightlife
	"bar": "nightlife", "cocktail": "nightlife", "club": "nightlife",
	"nightlife": "nightlife", "pub": "nightlife", "rooftop": "nightlife",
	// wellness
	"spa": "wellness", "gym": "wellness", "yoga": "wellness",
	"wellness": "wellness", "fitness": "wellness",
	// entertainment
	"cinema": "entertainment", "theatre": "entertainment", "movie": "entertainment",
	"entertainment": "entertainment", "bowling": "entertainment",
	"arcade": "entertainment", "concert": "entertainment",
}

// CategoryEmoji returns a representative emoji for each category slug.
var CategoryEmoji = map[string]string{
	"food":          "🍽️",
	"coffee":        "☕",
	"outdoors":      "🌳",
	"arts":          "🎨",
	"shopping":      "🛍️",
	"nightlife":     "🍸",
	"wellness":      "💆",
	"entertainment": "🎬",
}

// CategoryLabel returns a human-readable display label for each category slug.
var CategoryLabel = map[string]string{
	"food":          "Food & Dining",
	"coffee":        "Coffee & Cafés",
	"outdoors":      "Outdoors & Parks",
	"arts":          "Arts & Culture",
	"shopping":      "Shopping",
	"nightlife":     "Bars & Nightlife",
	"wellness":      "Wellness & Fitness",
	"entertainment": "Entertainment",
}
