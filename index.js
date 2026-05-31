require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"], credentials: true }));
app.use(express.json());

// MongoDB
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        await client.connect();
        console.log("Connected to MongoDB!");

        const db = client.db("microTaskDB");
        const usersCollection = db.collection("users");
        const tasksCollection = db.collection("tasks");
        const submissionsCollection = db.collection("submissions");
        const withdrawalsCollection = db.collection("withdrawals");
        const paymentsCollection = db.collection("payments");
        const notificationsCollection = db.collection("notifications");

        // JWT
        app.post("/jwt", async (req, res) => {
            const { email } = req.body;
            const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: "7d" });
            res.send({ token });
        });

        // Verify Token Middleware
        const verifyToken = (req, res, next) => {
            const token = req.headers.authorization?.split(" ")[1];
            if (!token) return res.status(401).send({ message: "Unauthorized" });
            jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) return res.status(401).send({ message: "Unauthorized" });
                req.decoded = decoded;
                next();
            });
        };

        // Verify Admin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const user = await usersCollection.findOne({ email });
            if (user?.role !== "admin") return res.status(403).send({ message: "Forbidden" });
            next();
        };

        // Verify Buyer
        const verifyBuyer = async (req, res, next) => {
            const email = req.decoded.email;
            const user = await usersCollection.findOne({ email });
            if (user?.role !== "buyer") return res.status(403).send({ message: "Forbidden" });
            next();
        };

        // Users Routes
        app.post("/users", async (req, res) => {
            const user = req.body;
            const existing = await usersCollection.findOne({ email: user.email });
            if (existing) return res.send({ message: "User already exists" });
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        app.get("/users/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const result = await usersCollection.findOne({ email });
            res.send(result);
        });

        app.patch("/users/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const update = req.body;
            const result = await usersCollection.updateOne({ email }, { $set: update });
            res.send(result);
        });

        app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        // Top Workers
        app.get("/top-workers", async (req, res) => {
            const result = await usersCollection
                .find({ role: "worker" })
                .sort({ coins: -1 })
                .limit(6)
                .toArray();
            res.send(result);
        });

        app.get("/", (req, res) => {
            res.send("MicroTask Server Running!");
        });

        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    } catch (err) {
        console.error(err);
    }
}

run();