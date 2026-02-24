import mongoose from 'mongoose';

const memorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  facts: [{ type: String }],
  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('Memory', memorySchema);