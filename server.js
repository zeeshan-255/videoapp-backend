const express = require("express");
const bodyParser = require("body-parser");
const sql = require("mssql");
const multer = require("multer");
const cors = require("cors");
const { BlobServiceClient } = require("@azure/storage-blob");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Multer setup for file upload
const upload = multer({ storage: multer.memoryStorage() });

// SQL configuration
const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DB,
  server: process.env.SQL_SERVER,
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

//  Upload video (Creators only)
app.post("/creator/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("No video uploaded");

    const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION);
    const containerClient = blobServiceClient.getContainerClient("videos");

    const blobName = Date.now() + "-" + req.file.originalname;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(req.file.buffer);
    const blobUrl = blockBlobClient.url;

    const pool = await sql.connect(sqlConfig);
    await pool.request()
      .input("Title", sql.NVarChar, req.body.title)
      .input("Publisher", sql.NVarChar, req.body.publisher)
      .input("Genre", sql.NVarChar, req.body.genre)
      .input("AgeRating", sql.NVarChar, req.body.ageRating)
      .input("BlobURL", sql.NVarChar, blobUrl)
      .input("CreatorID", sql.Int, req.body.creatorId)
      .query(`
        INSERT INTO Videos (Title, Publisher, Genre, AgeRating, BlobURL, CreatorID, CreatedAt)
        VALUES (@Title, @Publisher, @Genre, @AgeRating, @BlobURL, @CreatorID, GETDATE())
      `);

    res.json({ message: "Video uploaded successfully", url: blobUrl });
  } catch (err) {
    console.error("Upload failed:", err);
    res.status(500).send("Upload failed: " + err.message);
  }
});

//  Fetch latest videos
app.get("/videos/latest", async (req, res) => {
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request()
      .query("SELECT TOP 10 * FROM Videos ORDER BY CreatedAt DESC");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).send("Fetch failed: " + err.message);
  }
});

//  Post a comment
app.post("/videos/:id/comments", async (req, res) => {
  try {
    const { userId, commentText } = req.body;
    const videoId = req.params.id;

    const pool = await sql.connect(sqlConfig);
    await pool.request()
      .input("VideoID", sql.Int, videoId)
      .input("UserID", sql.Int, userId)
      .input("CommentText", sql.NVarChar, commentText)
      .query("INSERT INTO Comments (VideoID, UserID, CommentText, CreatedAt) VALUES (@VideoID, @UserID, @CommentText, GETDATE())");

    res.json({ message: "Comment added" });
  } catch (err) {
    res.status(500).send("Failed to add comment: " + err.message);
  }
});

//  Get comments for a video
app.get("/videos/:id/comments", async (req, res) => {
  try {
    const videoId = req.params.id;
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request()
      .input("VideoID", sql.Int, videoId)
      .query("SELECT * FROM Comments WHERE VideoID=@VideoID ORDER BY CreatedAt DESC");

    res.json(result.recordset);
  } catch (err) {
    res.status(500).send("Failed to fetch comments: " + err.message);
  }
});

//  Rate a video
app.post("/videos/:id/rate", async (req, res) => {
  try {
    const { userId, stars } = req.body;
    const videoId = req.params.id;

    if (stars < 1 || stars > 5) {
      return res.status(400).send("Stars must be between 1 and 5");
    }

    const pool = await sql.connect(sqlConfig);
    await pool.request()
      .input("VideoID", sql.Int, videoId)
      .input("UserID", sql.Int, userId)
      .input("Stars", sql.Int, stars)
      .query("INSERT INTO Ratings (VideoID, UserID, Stars, CreatedAt) VALUES (@VideoID, @UserID, @Stars, GETDATE())");

    res.json({ message: "Rating submitted" });
  } catch (err) {
    res.status(500).send("Failed to rate video: " + err.message);
  }
});

//  Fetch average rating for a video
app.get("/videos/:id/ratings", async (req, res) => {
  try {
    const videoId = req.params.id;
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request()
      .input("VideoID", sql.Int, videoId)
      .query("SELECT AVG(CAST(Stars AS FLOAT)) AS AvgRating, COUNT(*) AS TotalRatings FROM Ratings WHERE VideoID=@VideoID");

    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).send("Failed to fetch ratings: " + err.message);
  }
});

//  User signup
app.post("/users/signup", async (req, res) => {
  try {
    const { username, email, passwordHash, role } = req.body;

    const pool = await sql.connect(sqlConfig);
    await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("Email", sql.NVarChar, email)
      .input("PasswordHash", sql.NVarChar, passwordHash)
      .input("Role", sql.NVarChar, role)
      .query("INSERT INTO Users (Username, Email, PasswordHash, Role, CreatedAt) VALUES (@Username, @Email, @PasswordHash, @Role, GETDATE())");

    res.json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).send("Signup failed: " + err.message);
  }
});

//  User login (fixed with case-insensitive email)
app.post("/users/login", async (req, res) => {
  try {
    const email = req.body.email.trim();
    const passwordHash = req.body.passwordHash.trim();

    const pool = await sql.connect(sqlConfig);
    const result = await pool.request()
      .input("Email", sql.NVarChar, email)
      .input("PasswordHash", sql.NVarChar, passwordHash)
      .query(`
        SELECT * FROM Users 
        WHERE Email COLLATE Latin1_General_CI_AS = @Email 
          AND PasswordHash = @PasswordHash
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = result.recordset[0];
    res.json({ message: "Login successful", user });
  } catch (err) {
    res.status(500).send("Login failed: " + err.message);
  }
});

//  Get all users (for admin/debugging)
app.get("/users", async (req, res) => {
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query("SELECT * FROM Users");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).send("Failed to fetch users: " + err.message);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API running on port ${port}`));
