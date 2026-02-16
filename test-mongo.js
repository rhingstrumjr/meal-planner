const mongoose = require('mongoose');

// Attempt 1: Standard SRV (What failed before)
// const URI = "mongodb+srv://rhingstrum:atlas123@cluster0.bibrvt3.mongodb.net/?appName=Cluster0";

// Attempt 2: Direct Connection (Guessing the shard address based on standard Atlas patterns)
// This is a guess. If this fails, we really need you to log into Atlas and click "Connect > Drivers > Node.js > 2.2.12 or later" to get the long string.
const URI = "mongodb://rhingstrum:atlas123@cluster0-shard-00-00.bibrvt3.mongodb.net:27017,cluster0-shard-00-01.bibrvt3.mongodb.net:27017,cluster0-shard-00-02.bibrvt3.mongodb.net:27017/?ssl=true&replicaSet=atlas-shard-0&authSource=admin&retryWrites=true&w=majority";

console.log("Testing connection...");

mongoose.connect(URI)
    .then(() => {
        console.log("✅ SUCCESS! Connected to MongoDB!");
        process.exit(0);
    })
    .catch(err => {
        console.error("❌ FAILED:", err.message);
        process.exit(1);
    });
