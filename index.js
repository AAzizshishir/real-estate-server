require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const admin = require("firebase-admin");

const decodedkey = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
try {
  const serviceAccount = JSON.parse(decodedkey);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("✅ Firebase initialized successfully");
} catch (error) {
  console.error("❌ Error parsing FB_SERVICE_KEY:", error);
}

const app = express();
const port = process.env.PORT || 5000;

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.pacddgd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Middlewares
app.use(cors());
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const database = client.db("EstateHub");
    const propertiesCollection = database.collection("properties");
    const usersCollection = database.collection("users");
    const wishlistCollection = database.collection("wishlists");
    const reviewsCollection = database.collection("reviews");
    const offersCollection = database.collection("offers");

    app.post("/jwt", async (req, res) => {
      const user = req.body;

      if (!user || !user.email) {
        return res.status(400).send({ message: "Invalid user" });
      }
      const token = jwt.sign(
        {
          email: user.email,
          role: user.role, // include user role
        },
        process.env.JWT_SECRET,
        {
          expiresIn: "30d",
        }
      );
      res.send({ token });
    });

    const verifyToken = (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).send({ message: "Unauthorized" });

      const token = authHeader.split(" ")[1];
      jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).send({ message: "Forbidden" });
        req.decoded = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden: admin only" });
      }

      next();
    };

    const verifyAgent = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });

      if (user?.role !== "agent") {
        return res.status(403).send({ message: "forbidden: agent only" });
      }

      next();
    };

    // ✅ GET: All users
    app.get("/users", verifyToken, async (req, res) => {
      try {
        const result = await usersCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to get users", error: error.message });
      }
    });

    // ✅ GET: Single user by email
    app.get("/users/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      try {
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }
        res.send(user);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to get user", error: error.message });
      }
    });

    // ✅ POST API for Users
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;

        // Check if user already exists by email
        const existingUser = await usersCollection.findOne({
          email: user.email,
        });
        if (existingUser) {
          return res.status(400).send({ message: "User already exists" });
        }

        // Insert new user
        const result = await usersCollection.insertOne(user);
        res.send(result);
      } catch (error) {
        console.error("Error saving user:", error);
        res.status(500).send({ message: "Failed to save user" });
      }
    });

    // ✅ Get All properties
    app.get("/properties", verifyToken, async (req, res) => {
      try {
        const allProperties = await propertiesCollection.find().toArray();
        res.send(allProperties);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch pending properties" });
      }
    });

    // ✅ Get All Verified properties
    app.get("/properties/verified", async (req, res) => {
      try {
        const verifiedProperties = await propertiesCollection
          .find({ status: "verified" })
          .sort({ minPrice: 1 }) // Sort by min price descending (min price first)
          .toArray();
        res.send(verifiedProperties);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch pending properties" });
      }
    });

    // ✅ Get My properties
    app.get("/my-properties", verifyToken, async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const result = await propertiesCollection
          .find({ agentEmail: email })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch properties" });
      }
    });

    // ✅ Update My properties
    app.put("/properties/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const propertyData = req.body;

      try {
        const result = await propertiesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: propertyData }
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .send({ message: "Property not found or not modified" });
        }

        res.status(200).send({ message: "Property updated successfully" });
      } catch (error) {
        console.error("Update error:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // ✅ Delete My properties
    app.delete("/properties/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await propertiesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Property not found" });
        }

        res.status(200).send({ message: "Property deleted successfully" });
      } catch (error) {
        console.error("Error deleting property:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // ✅ Get Specific property
    app.get("/properties/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const query = { _id: new ObjectId(id) };
        const property = await propertiesCollection.findOne(query);

        if (!property) {
          return res.status(404).send({ message: "Property not found" });
        }

        res.send(property);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to get property" });
      }
    });

    // ✅ POST API to add a property
    app.post("/properties", verifyToken, async (req, res) => {
      const property = req.body;
      console.log("Received property:", property);

      const result = await propertiesCollection.insertOne(property);
      res.send(result);
    });

    // ✅ Verify property
    app.patch("/properties/verify/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await propertiesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "verified" } }
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to verify property" });
      }
    });

    // ✅ Reject property
    app.patch("/properties/reject/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await propertiesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "rejected" } }
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to reject property" });
      }
    });

    // Admin API
    // Admin Summury
    app.get(
      "/admin-dashboard-summary",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const [totalUsers, totalAdmins, totalAgents] = await Promise.all([
            usersCollection.countDocuments({ role: "user" }),
            usersCollection.countDocuments({ role: "admin" }),
            usersCollection.countDocuments({ role: "agent" }),
          ]);

          const [
            allProperties,
            pendingProperties,
            acceptedProperties,
            rejectedProperties,
            advertisedProperties,
          ] = await Promise.all([
            propertiesCollection.estimatedDocumentCount(),
            propertiesCollection.countDocuments({ status: "pending" }),
            propertiesCollection.countDocuments({ status: "verified" }),
            propertiesCollection.countDocuments({ status: "rejected" }),
            propertiesCollection.countDocuments({ advertise: true }),
          ]);

          const totalReviews = await reviewsCollection.estimatedDocumentCount();

          res.send({
            totalUsers,
            totalAdmins,
            totalAgents,
            allProperties,
            pendingProperties,
            acceptedProperties,
            rejectedProperties,
            totalReviews,
            advertisedProperties,
          });
        } catch (err) {
          res
            .status(500)
            .send({ message: "Failed to load summary", error: err.message });
        }
      }
    );

    // Make Admin
    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        try {
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role: "admin" } }
          );

          if (result.matchedCount === 0) {
            return res.status(404).send({ message: "User not found" });
          }

          res.send({ success: true, message: "User promoted to admin" });
        } catch (error) {
          console.error("Make admin error:", error);
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    // Make Agent
    app.patch(
      "/users/agent/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        try {
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role: "agent" } }
          );

          if (result.matchedCount === 0) {
            return res.status(404).send({ message: "User not found" });
          }

          res.send({ success: true, message: "User promoted to agent" });
        } catch (error) {
          console.error("Make agent error:", error);
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    // Mark Fraud
    app.patch(
      "/users/fraud/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        try {
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { fraud: true } }
          );

          if (result.matchedCount === 0) {
            return res.status(404).send({ message: "User not found" });
          }

          res.send({ success: true, message: "User marked as fraud" });
        } catch (error) {
          console.error("Mark fraud error:", error);
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    // Delete user
    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;

      try {
        // Step 1: Find user from MongoDB (to get uid)
        const user = await usersCollection.findOne({ _id: new ObjectId(id) });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }
        // Step 2: Delete user from Firebase Auth (if uid exists)
        if (user.uid) {
          try {
            await admin.auth().deleteUser(user.uid);
          } catch (firebaseErr) {
            console.error("Firebase delete error:", firebaseErr.message);
          }
        }
        // Step 3: Delete user from MongoDB
        const result = await usersCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send({ success: true, message: "User deleted" });
      } catch (error) {
        console.error("Delete user error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get data from Wishlist with emial
    app.get("/wishlist", verifyToken, async (req, res) => {
      try {
        const email = req.query.email;
        const result = await wishlistCollection
          .find({ userEmail: email })
          .toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to get wishlist data" });
      }
    });

    // Get data from Wishlist with ID
    app.get("/wishlist/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await wishlistCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!result) {
        return res.status(404).send({ message: "Wishlist item not found" });
      }
      res.send(result);
    });

    // Add to Wishlist
    app.post("/wishlist", verifyToken, async (req, res) => {
      try {
        const wishlistItem = req.body;
        const result = await wishlistCollection.insertOne(wishlistItem);
        res.status(201).send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to add to wishlist" });
      }
    });

    // Delete from Wishlist
    app.delete("/wishlist/:id", verifyToken, async (req, res) => {
      const id = req.params.id;

      try {
        const query = { _id: new ObjectId(id) };
        const result = await wishlistCollection.deleteOne(query);

        if (result.deletedCount > 0) {
          return res
            .status(200)
            .send({ message: "Wishlist item deleted successfully" });
        } else {
          return res.status(404).send({ message: "Wishlist item not found" });
        }
      } catch (error) {
        console.error("Failed to delete wishlist item", error);
        return res.status(500).send({ message: "Internal server error" });
      }
    });

    // Offer
    // ✅ Get offer data
    app.get("/bought-properties", verifyToken, async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const properties = await offersCollection
          .find({ buyerEmail: email })
          .toArray();
        res.send(properties);
      } catch (error) {
        res.status(500).send({ message: "Failed to get bought properties" });
      }
    });

    // Get offers for agent
    app.get("/offers", verifyToken, async (req, res) => {
      try {
        const agentEmail = req.query.agentEmail;
        if (!agentEmail) {
          return res.status(400).send({ message: "Agent email is required" });
        }

        const offers = await offersCollection
          .find({
            agentEmail,
            status: { $in: ["pending", "accepted", "rejected"] },
          })
          .toArray();
        res.send(offers);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to get offers", error: error.message });
      }
    });

    // Get sold property for agent
    app.get(
      "/agent-sold-properties/:agentEmail",
      verifyToken,
      verifyAgent,
      async (req, res) => {
        const agentEmail = req.params.agentEmail;

        try {
          const soldOffers = await offersCollection
            .find({
              agentEmail: agentEmail,
              status: "bought",
            })
            .toArray();

          res.send(soldOffers);
        } catch (error) {
          console.log(error);
          res.status(500).send({ message: "Failed to load sold properties" });
        }
      }
    );

    // Get offers with id
    app.get("/offers/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      try {
        const offer = await offersCollection.findOne({ _id: new ObjectId(id) });
        if (!offer) {
          return res.status(404).send({ message: "Offer not found" });
        }
        res.send(offer);
      } catch (error) {
        console.error("Failed to get offer:", error);
        res.status(500).send({ message: "Failed to fetch offer" });
      }
    });

    // ✅ Post offer data
    app.post("/offers", verifyToken, async (req, res) => {
      try {
        const offerData = req.body;
        const result = await offersCollection.insertOne(offerData);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to create offer" });
      }
    });

    // Accept offer
    app.patch(
      "/offers/accept/:id",
      verifyToken,
      verifyAgent,
      async (req, res) => {
        try {
          const id = req.params.id;

          // Find the accepted offer first
          const acceptedOffer = await offersCollection.findOne({
            _id: new ObjectId(id),
          });

          const propertyId = acceptedOffer.propertyId;

          const result = await offersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "accepted" } }
          );

          // Reject all other offers for this property
          await offersCollection.updateMany(
            {
              propertyId: propertyId,
              _id: { $ne: new ObjectId(id) },
            },
            { $set: { status: "rejected" } }
          );

          if (result.modifiedCount === 0) {
            return res
              .status(404)
              .send({ message: "Offer not found or already updated" });
          }

          res.send({
            message: "Offer accepted and other offers rejected successfully",
          });
        } catch (error) {
          res
            .status(500)
            .send({ message: "Failed to accept offer", error: error.message });
        }
      }
    );

    // Reject offer
    app.patch(
      "/offers/reject/:id",
      verifyToken,
      verifyAgent,
      async (req, res) => {
        try {
          const id = req.params.id;

          const result = await offersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "rejected" } }
          );

          if (result.modifiedCount === 0) {
            return res
              .status(404)
              .send({ message: "Offer not found or already updated" });
          }

          res.send({ message: "Offer rejected successfully" });
        } catch (error) {
          res
            .status(500)
            .send({ message: "Failed to reject offer", error: error.message });
        }
      }
    );

    // Reviews

    // Get all reviews
    app.get("/reviews", verifyToken, async (req, res) => {
      try {
        const reviews = await reviewsCollection.find().toArray();
        res.send(reviews);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch reviews" });
      }
    });

    // GET: 3 Latest Reviews
    app.get("/latest-reviews", async (req, res) => {
      try {
        const result = await reviewsCollection
          .find()
          .sort({ date: -1 }) // Sort by date descending (latest first)
          .limit(3)
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching latest reviews:", error);
        res.status(500).send({ message: "Failed to fetch latest reviews" });
      }
    });

    // ✅ Get reviews by email
    app.get("/my-reviews", verifyToken, async (req, res) => {
      const email = req.query.email;
      const result = await reviewsCollection
        .find({ reviewerEmail: email })
        .toArray();
      res.send(result);
    });

    // ✅ Get reviews by propertyId
    app.get("/reviews/:propertyId", verifyToken, async (req, res) => {
      const propertyId = req.params.propertyId;
      const reviews = await reviewsCollection
        .find({ propertyId })
        .sort({ date: -1 })
        .toArray();
      res.send(reviews);
    });

    // ✅ Post a new review
    app.post("/reviews", verifyToken, async (req, res) => {
      const review = req.body;
      const result = await reviewsCollection.insertOne(review);
      res.status(201).send(result);
    });

    // ✅ Delete a review by ID
    app.delete("/reviews/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const result = await reviewsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      if (result.deletedCount > 0) {
        res.send({ success: true, message: "Review deleted" });
      } else {
        res.status(404).send({ success: false, message: "Review not found" });
      }
    });

    // Payment
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;

      const amount = parseInt(price * 100);

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.patch("/offers/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { transactionId } = req.body;

      try {
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: "bought",
            transactionId: transactionId,
          },
        };

        const result = await offersCollection.updateOne(filter, updateDoc);
        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .send({ message: "Offer not found or already updated" });
        }

        res.send({
          message: "Offer updated to bought successfully!",
          result,
        });
      } catch (error) {
        console.log("Payment success update error:", error);
        res.status(500).send({
          message: "Failed to update offer status",
          error: error.message,
        });
      }
    });

    // Get Advertise properties
    app.get("/advertised", async (req, res) => {
      try {
        const result = await propertiesCollection
          .find({ advertise: true })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch advertise property" });
      }
    });

    //  Mark property as advertised
    app.patch("/properties/advertise/:id", async (req, res) => {
      const id = req.params.id;
      const result = await propertiesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { advertise: true } }
      );
      res.send(result);
    });

    // Get Top Agent
    // ✅ GET: Top Agents
    app.get("/top-agents", async (req, res) => {
      try {
        const agents = await usersCollection
          .find({ role: "agent" })
          .limit(6) // Optional: show top 6 agents
          .toArray();

        res.send(agents);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to load top agents", error: error.message });
      }
    });

    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Example route
app.get("/", (req, res) => {
  res.send("Server is running!");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
