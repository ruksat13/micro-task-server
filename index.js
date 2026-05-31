require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
    origin: [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "https://flourishing-liger-05e60c.netlify.app"
    ],
    credentials: true
}));

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

        // Verify Token
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

        // ==================== USERS ====================
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

        app.get("/top-workers", async (req, res) => {
            const result = await usersCollection
                .find({ role: "worker" })
                .sort({ coins: -1 })
                .limit(6)
                .toArray();
            res.send(result);
        });

        // ==================== TASKS ====================
        app.post("/tasks", verifyToken, verifyBuyer, async (req, res) => {
            const task = req.body;
            const result = await tasksCollection.insertOne(task);
            res.send(result);
        });

        app.get("/tasks", verifyToken, async (req, res) => {
            const result = await tasksCollection.find({ required_workers: { $gt: 0 } }).toArray();
            res.send(result);
        });

        app.get("/tasks/all", verifyToken, verifyAdmin, async (req, res) => {
            const result = await tasksCollection.find().toArray();
            res.send(result);
        });

        app.get("/tasks/buyer/:email", verifyToken, verifyBuyer, async (req, res) => {
            const email = req.params.email;
            const result = await tasksCollection
                .find({ buyer_email: email })
                .sort({ completion_date: -1 })
                .toArray();
            res.send(result);
        });

        app.get("/tasks/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const result = await tasksCollection.findOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        app.put("/tasks/:id", verifyToken, verifyBuyer, async (req, res) => {
            const id = req.params.id;
            const update = req.body;
            const result = await tasksCollection.updateOne({ _id: new ObjectId(id) }, { $set: update });
            res.send(result);
        });

        app.delete("/tasks/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const result = await tasksCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        // ==================== SUBMISSIONS ====================
        app.post("/submissions", verifyToken, async (req, res) => {
            const submission = req.body;
            const result = await submissionsCollection.insertOne(submission);
            // Notify buyer
            await notificationsCollection.insertOne({
                message: `${submission.worker_name} submitted work for your task "${submission.task_title}"`,
                toEmail: submission.buyer_email,
                actionRoute: "/dashboard/task-to-review",
                time: new Date(),
                read: false,
            });
            res.send(result);
        });

        app.get("/submissions/worker/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const skip = (page - 1) * limit;
            const total = await submissionsCollection.countDocuments({ worker_email: email });
            const result = await submissionsCollection
                .find({ worker_email: email })
                .skip(skip)
                .limit(limit)
                .toArray();
            res.send({ submissions: result, total, page, totalPages: Math.ceil(total / limit) });
        });

        app.get("/submissions/buyer/:email", verifyToken, verifyBuyer, async (req, res) => {
            const email = req.params.email;
            const result = await submissionsCollection
                .find({ buyer_email: email, status: "pending" })
                .toArray();
            res.send(result);
        });

        app.patch("/submissions/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const { status, payable_amount, worker_email, task_id, worker_name, task_title, buyer_name, buyer_email } = req.body;
            const result = await submissionsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status } }
            );

            if (status === "approved") {
                await usersCollection.updateOne(
                    { email: worker_email },
                    { $inc: { coins: payable_amount } }
                );
                await notificationsCollection.insertOne({
                    message: `You have earned 🪙${payable_amount} from ${buyer_name} for completing "${task_title}"`,
                    toEmail: worker_email,
                    actionRoute: "/dashboard/worker-home",
                    time: new Date(),
                    read: false,
                });
            }

            if (status === "rejected") {
                await tasksCollection.updateOne(
                    { _id: new ObjectId(task_id) },
                    { $inc: { required_workers: 1 } }
                );
                await notificationsCollection.insertOne({
                    message: `Your submission for "${task_title}" was rejected`,
                    toEmail: worker_email,
                    actionRoute: "/dashboard/my-submissions",
                    time: new Date(),
                    read: false,
                });
            }

            res.send(result);
        });

        // ==================== WITHDRAWALS ====================
        app.post("/withdrawals", verifyToken, async (req, res) => {
            const withdrawal = req.body;
            const result = await withdrawalsCollection.insertOne(withdrawal);
            await usersCollection.updateOne(
                { email: withdrawal.worker_email },
                { $inc: { coins: -withdrawal.withdrawal_coin } }
            );
            res.send(result);
        });

        app.get("/withdrawals", verifyToken, verifyAdmin, async (req, res) => {
            const result = await withdrawalsCollection.find({ status: "pending" }).toArray();
            res.send(result);
        });

        app.patch("/withdrawals/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const withdrawal = await withdrawalsCollection.findOne({ _id: new ObjectId(id) });
            const result = await withdrawalsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: "approved" } }
            );
            if (withdrawal) {
                await notificationsCollection.insertOne({
                    message: `Your withdrawal of $${withdrawal.withdrawal_amount} has been approved!`,
                    toEmail: withdrawal.worker_email,
                    actionRoute: "/dashboard/withdrawals",
                    time: new Date(),
                    read: false,
                });
            }
            res.send(result);
        });

        // ==================== PAYMENTS ====================
        app.post("/payments", verifyToken, async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            res.send(result);
        });

        app.get("/payments/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const result = await paymentsCollection
                .find({ buyer_email: email })
                .sort({ date: -1 })
                .toArray();
            res.send(result);
        });

        // ==================== NOTIFICATIONS ====================
        app.post("/notifications", verifyToken, async (req, res) => {
            const notification = req.body;
            const result = await notificationsCollection.insertOne(notification);
            res.send(result);
        });

        app.get("/notifications/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const result = await notificationsCollection
                .find({ toEmail: email })
                .sort({ time: -1 })
                .toArray();
            res.send(result);
        });

        app.patch("/notifications/read/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const result = await notificationsCollection.updateMany(
                { toEmail: email, read: { $ne: true } },
                { $set: { read: true } }
            );
            res.send(result);
        });

        // ==================== ADMIN STATS ====================
        app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
            const totalWorkers = await usersCollection.countDocuments({ role: "worker" });
            const totalBuyers = await usersCollection.countDocuments({ role: "buyer" });
            const allUsers = await usersCollection.find().toArray();
            const totalCoins = allUsers.reduce((sum, u) => sum + (u.coins || 0), 0);
            const payments = await paymentsCollection.find().toArray();
            const totalPayments = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
            res.send({ totalWorkers, totalBuyers, totalCoins, totalPayments });
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