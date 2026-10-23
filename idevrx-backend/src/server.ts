import mongoose from "mongoose";
import { config } from "./config.js";
import { app } from "./app.js";

await mongoose.connect(config.MONGODB_URI);
await mongoose.syncIndexes(); // text search, unique project numbers, one report per person, token expiry
app.listen(config.PORT, () => console.log(`Idevrx API listening on :${config.PORT}`));
