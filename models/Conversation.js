import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    default: 'New Chat'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('Conversation', conversationSchema);
