const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.yfvcqxe.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // await client.connect();

        const BioDataCollection = client.db('WedMateDB').collection('Biodatas');
        const SuccessStoriesCollection = client.db('WedMateDB').collection('SuccessStories');
        const UserCollection = client.db('WedMateDB').collection('Users');
        const PaidCollection = client.db('WedMateDB').collection('Paid');
        // jwt
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '24h' });
            res.send({ token });
        })
        const verifyToken = (req, res, next) => {
            const authHeader = req.headers.authorization;
            console.log(req.headers.authorization)
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'Unauthorized access, no token provided' });
            }

            const token = authHeader.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    console.error('Token verification error:', err); // Debug log
                    return res.status(401).send({ message: 'Unauthorized access, invalid token' });
                }
                req.decoded = decoded;
                next();
            });
        };

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const user = await UserCollection.findOne({ email: email });
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // stripe
        app.post('/create-payment-intent', async (req, res) => {
            const { amount } = req.body;

            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount,
                    currency: 'usd',
                    payment_method_types: ['card'],
                });

                res.send({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).send({ error: error.message });
            }
        });
        // Contact request 

        app.post('/contact-requests', async (req, res) => {
            const { biodataId, email } = req.body;
            const id = parseInt(biodataId.substring(1));
            console.log({ id, email });

            if (!biodataId || !email) {
                return res.status(400).send({ message: " ID and Email are required." });
            }
            try {
                const filter = { bioData_id: id };
                const biodata = await BioDataCollection.findOne(filter)
                console.log(biodata)
                const updatedDoc = {
                    bioData_id: biodata.bioData_id,
                    name: biodata.name,
                    contact_email: biodata.contact_email,
                    contact_phone: biodata.mobile_number,
                    image: biodata.profile_image,
                    checkoutEmail: email,
                    checkoutCreatedAt: new Date(),
                    status: "Pending"
                }
                const result = await PaidCollection.insertOne(updatedDoc);
                res.send(result)
            } catch (error) {
                res.status(500).send({ message: 'Internal server error' });
            }
        });

        app.get('/requested-contacts', async (req, res) => {
            const email = req.query.email;
            console.log(email)
            const query = { checkoutEmail: email };
            const result = await PaidCollection.find(query).toArray();
            res.send(result);
        })

        app.get('/contact-requests-pending', async (req, res) => {
            const query = { status: "Pending" };
            const result = await PaidCollection.find(query).toArray();
            res.send(result);
        })

        app.delete('/delete-contacts/:id', async (req, res) => {
            const { id } = req.params;
            console.log(id)
            const query = { _id: new ObjectId(id) };
            const result = await PaidCollection.deleteOne(query);
            res.send(result);
        })
        app.patch('/contact-requests-approve/:id', async (req, res) => {
            const { id } = req.params;
            console.log(id)
            const query = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    status: "Approved"
                }
            }
            const result = await PaidCollection.updateOne(query, updatedDoc);
            res.send(result);
        })


        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;

            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' })
            }

            const query = { email: email };
            const user = await UserCollection.findOne(query);
            let admin = false;
            if (user) {
                admin = user?.role === 'admin';
            }
            res.send({ admin });
        })

        app.get("/single-user/:email", async (req, res) => {
            const email = req.params.email;
            console.log(email);
            const user = await UserCollection.findOne({ email: email });
            res.send(user);
        })

        // Biodata routes
        app.get('/biodatas', async (req, res) => {
            const { limit = 9, offset = 0, ageMin, ageMax, bioDataType, division } = req.query;

            const filter = {};
            if (ageMin && ageMax) {
                filter.age = { $gte: parseInt(ageMin), $lte: parseInt(ageMax) };
            }
            if (bioDataType) {
                filter.bioData_type = bioDataType;
            }
            if (division) {
                filter.permanent_division = division;
            }

            const biodatas = await BioDataCollection.find(filter)
                .skip(parseInt(offset))
                .limit(parseInt(limit))
                .toArray();

            const totalBiodatasCount = await BioDataCollection.countDocuments(filter);

            res.json({ biodatas, totalCount: totalBiodatasCount });
        });

        app.get('/related-biodatas', async (req, res) => {
            const { limit = 3, gender, excludeid } = req.query;
            const relatedBiodatas = await BioDataCollection.find({ bioData_type: gender, bioData_id: { $ne: parseInt(excludeid) } })
                .limit(parseInt(limit))
                .toArray();
            res.send(relatedBiodatas);
        });

        app.get('/biodatas/premium', async (req, res) => {
            const { limit = 6, offset = 0 } = req.query;
            const biodatas = await BioDataCollection.find({ tire: "premium" })
                .skip(parseInt(offset))
                .limit(parseInt(limit))
                .toArray();

            const totalPremiumBiodatasCount = await BioDataCollection.countDocuments({ isPaid: "true" });

            res.json({ biodatas, totalCount: totalPremiumBiodatasCount });
        });

        app.get('/biodata/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const biodata = await BioDataCollection.findOne(query);
            res.send(biodata);
        });

        app.get('/user/biodata', async (req, res) => {
            const { email } = req.query;
            console.log(email);
            const biodata = await BioDataCollection.findOne({ contact_email: email });
            res.json(biodata);
        });
        app.get('/user-home/biodata', async (req, res) => {
            const { email } = req.query;
            console.log(email);
            const biodata = await BioDataCollection.findOne({ contact_email: email });
            res.json(biodata);
        });

        // Success Stories route
        app.get('/success-stories', async (req, res) => {
            const stories = await SuccessStoriesCollection.find({}).toArray();
            res.send(stories);
        });
        app.delete('/success-stories/:id', async (req, res) => {
            const id = req.params.id;
            console.log(id);
            const result = await SuccessStoriesCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        // User routes
        app.get('/users-new', async (req, res) => {
            const user = req.query;
            console.log(user)
            // const query = { email: user };
            // console.log(query)
            const existingUser = await UserCollection.findOne(user);
            if (existingUser) {
                return res.send({ message: 'User already exists', insertedId: null });
            }
            res.send({ message: 'New User', insertedId: 1 })
        });

        app.get('/all-users', async (req, res) => {
            const result = await UserCollection.find().toArray();
            res.send(result);
        });

        // premium er khela

        app.get('/premium-requests', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const pendingUsers = await BioDataCollection.find({ tire: 'pending' }).toArray();
                res.status(200).send(pendingUsers);
            } catch (error) {
                res.status(500).send({ message: "An error occurred while fetching premium requests.", error });
            }
        });

        app.post('/premium-request', verifyToken, async (req, res) => {
            const { email } = req.body;
            console.log(email)
            if (!email) {
                return res.status(400).send({ message: "Email is required." });
            }

            try {
                const biodata = await BioDataCollection.findOne({ contact_email: email });

                if (!biodata) {
                    return res.status(404).send({ message: "User not found." });
                }

                if (biodata.tire === 'premium') {
                    return res.send({ success: false, message: "💲You are already a premium member." });
                }

                if (biodata.tire === 'pending') {
                    return res.send({ success: false, message: "Already sent premium request❗" });
                }

                const filter = { contact_email: email };
                const updatedDoc = {
                    $set: {
                        tire: 'pending',
                        requestedAt: new Date()
                    }
                };

                const result = await BioDataCollection.updateOne(filter, updatedDoc);

                if (result.modifiedCount > 0) {
                    res.status(200).send({
                        success: true,
                        message: "Premium request sent successfully."
                    });
                } else {
                    res.status(400).send({
                        success: false,
                        message: "Failed to send premium request."
                    });
                }
            } catch (error) {
                res.status(500).send({ message: "An error occurred while sending the premium request.", error });
            }
        });


        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await UserCollection.updateOne(filter, updatedDoc);
            res.send(result);
        })

        app.patch('/users/premium', verifyToken, verifyAdmin, async (req, res) => {
            const { id, email } = req.body;

            if (!id || !email) {
                return res.status(400).send({ message: "User ID and Email are required." });
            }

            const filterUser = { _id: new ObjectId(id) };
            const filterBiodata = { contact_email: email };
            const updatedDoc = {
                $set: {
                    tire: 'premium',
                    approvedAt: new Date()
                }
            };

            try {
                const resultUser = await UserCollection.updateOne(filterUser, updatedDoc);
                const resultBiodata = await BioDataCollection.updateOne(filterBiodata, updatedDoc);

                if (resultUser.modifiedCount > 0 && resultBiodata.modifiedCount > 0) {
                    res.status(200).send({
                        message: "User and Biodata updated successfully.",
                        resultUser,
                        resultBiodata
                    });
                } else {
                    res.status(400).send({
                        message: "Failed to update.",
                        resultUser,
                        resultBiodata
                    });
                }
            } catch (error) {
                res.status(500).send({ message: "An error occurred while updating the documents.", error });
            }
        });
        // for approved 
        app.patch('/users/make-premium/:email', verifyToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            console.log(email);

            if (!email) {
                return res.status(400).send({ message: "Email is required." });
            }

            try {
                const biodata = await BioDataCollection.findOne({ contact_email: email });
                const user = await UserCollection.findOne({ email: email });

                if (!user || !biodata) {
                    return res.status(404).send({ message: "User or Biodata not found." });
                }

                const filterUser = { email: email };
                const filterBiodata = { contact_email: email };
                const updatedDoc = {
                    $set: {
                        tire: 'premium',
                        approvedAt: new Date()
                    }
                };

                const resultUser = await UserCollection.updateOne(filterUser, updatedDoc);
                const resultBiodata = await BioDataCollection.updateOne(filterBiodata, updatedDoc);

                if (resultUser.modifiedCount > 0 && resultBiodata.modifiedCount > 0) {
                    res.status(200).send({
                        success: true,
                        message: "User and Biodata updated successfully.",
                        resultUser,
                        resultBiodata
                    });
                } else {
                    res.status(400).send({
                        success: false,
                        message: "Failed to update User and/or Biodata.",
                        resultUser,
                        resultBiodata
                    });
                }
            } catch (error) {
                res.status(500).send({ message: "An error occurred while updating the documents.", error });
            }
        });
        app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await UserCollection.deleteOne(query);
            res.send(result);
        })


        app.get('/last-biodata-id', async (req, res) => {
            const result = await BioDataCollection.find({}, { projection: { _id: 0, bioData_id: 1 } })
                .sort({ bioData_id: -1 })
                .limit(1)
                .toArray();
            res.send(result);
        });



        app.post('/users', async (req, res) => {
            const user = req.body;
            console.log({ user })
            const result = await UserCollection.insertOne(user)
            res.json(result);
        })
        app.post('/new-biodata', async (req, res) => {
            const biodata = req.body;
            console.log({ biodata })
            const result = await BioDataCollection.insertOne(biodata)
            res.json(result);
        })

        app.put('/update/biodata/:email', async (req, res) => {
            const email = req.params.email;
            const formData = req.body;

            try {
                const query = { contact_email: email };
                const update = { $set: formData };
                const options = {
                    upsert: true,
                }

                const result = await BioDataCollection.updateOne(query, update, options);
                console.log({ result })
                if (result.modifiedCount === 1) {
                    res.send({ message: 'Biodata updated successfully', data: result.value });
                } else {
                    res.status(404).send({ message: 'Biodata not found' });
                }
            } catch (err) {
                console.error('Error updating biodata:', err);
                res.status(500).send({ message: 'Internal server error' });
            }
        });

        app.post('/favorites', verifyToken, async (req, res) => {
            const { email, bioDataId } = req.body;
            console.log({ bioDataId })
            const user = await UserCollection.findOne({ email });
            console.log({ user })

            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            const result = await UserCollection.updateOne(
                { email },
                { $addToSet: { favorites: bioDataId } }
            );
            console.log(result)
            res.send(result);
        });

        app.get('/favorites/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const user = await UserCollection.findOne({ email });

            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            const favorites = user.favorites || [];
            const favoriteBiodatas = await BioDataCollection.find({ bioData_id: { $in: favorites } }).toArray();

            res.send(favoriteBiodatas);
        });

        app.post('/got-married', async (req, res) => {
            const successStory = req.body
            console.log(successStory);
            const user = await SuccessStoriesCollection.findOne({ email: successStory.email });
            if (user) {
                return res.send({ message: 'Already Added Success Story' });
            }
            const result = await SuccessStoriesCollection.insertOne(successStory)
            res.send(result);
        })

        app.delete('/favorites', verifyToken, async (req, res) => {
            const { email, bioDataId } = req.body;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'Forbidden access' });
            }
            console.log(email, bioDataId);

            try {
                const result = await UserCollection.updateOne(
                    { email: email },
                    { $pull: { favorites: bioDataId } }
                );
                console.log(result)
                res.send(result);

            } catch (error) {
                console.error('Error removing from favorites:', error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });


        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello World');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
