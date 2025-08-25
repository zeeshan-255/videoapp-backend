const express = require("express");
const bodyParser = require("body-parser");
const sql = require("mssql");
const multer = require("multer");
const { BlobServiceClient } = require("@azure/storage-blob");

const app = express();
app.use(bodyParser.json());
app.use(require("cors")());

const upload = multer({ storage: multer.memoryStorage() });

// SQL config
const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DB,
  server: process.env.SQL_SERVER,
  options: { encrypt: true, trustServerCertificate: false }
};

// Upload video (Creator role)
app.post("/creator/upload", upload.single("video"), async (req, res) => {
  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION);
    const containerClient = blobServiceClient.getContainerClient("videos");
    const blobName = Date.now() + "-" + req.file.originalname;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(req.file.buffer);
    const videoUrl = blockBlobClient.url;

    // Save metadata in SQL
    const pool = await sql.connect(sqlConfig);
    await pool.request()
      .input("title", req.body.title)
      .input("publisher", req.body.publisher)
      .input("genre", req.body.genre)
      .input("ageRating", req.body.ageRating)
      .input("videoUrl", videoUrl)
      .query("INSERT INTO Videos (Title, Publisher, Genre, AgeRating, BlobURL) VALUES (@title, @publisher, @genre, @ageRating, @videoUrl)");

    res.json({ message: " Video uploaded successfully", url: videoUrl });
  } catch (err) {
    res.status(500).send(" Upload failed: " + err.message);
  }
});

// Get latest videos
app.get("/videos/latest", async (req, res) => {
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query("SELECT TOP 10 * FROM Videos ORDER BY CreatedAt DESC");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).send(" Fetch failed: " + err.message);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(` API running on port ${port}`));
