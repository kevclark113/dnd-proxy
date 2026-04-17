const express = require("express");
const cors    = require("cors");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","X-API-Key"]
}));

app.options("*", cors());
app.use(express.json({ limit: "2mb" }));

app.post("/api/dm", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(401).json({ error: "No API key provided. Please add your Anthropic API key in the app settings." });
  }
  if (!apiKey.startsWith("sk-ant-")) {
    return res.status(401).json({ error: "Invalid API key format." });
  }
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DM proxy running on port ${PORT}`));
