const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const Task = require('./models/Task');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PATCH', 'DELETE']
  }
});

app.use(cors());
app.use(express.json());

// TEMP: store tasks in memory
let tasks = [];

// Calculate Priority Score
function calculatePriorityScore(task) {
  const now = Date.now();
  const timeSinceUpdate = now - new Date(task.updated_at).getTime();
  const timeUntilDeadline = new Date(task.deadline).getTime() - now;
  
  if (timeUntilDeadline <= 0) return Infinity;
  
  return (timeSinceUpdate * task.volatility_factor) / timeUntilDeadline;
}

// Helper: Get tasks with scores
function getTasksWithScores() {
  const tasksWithScores = tasks.map(task => ({
    ...task,
    priority_score: calculatePriorityScore(task)
  }));
  
  tasksWithScores.sort((a, b) => b.priority_score - a.priority_score);
  
  return tasksWithScores;
}

// broadcast tasks to all connected clients
function broadcastTasks() {
  io.emit('tasks_updated', getTasksWithScores());
}

// WebSocket Connection
io.on('connection', (socket) => {
  console.log('✓ Client connected:', socket.id);
  
  // Send initial tasks
  socket.emit('tasks_updated', getTasksWithScores());
  
  socket.on('disconnect', () => {
    console.log('✗ Client disconnected:', socket.id);
  });
});

// Routes
app.get('/tasks', (req, res) => {
  res.json(getTasksWithScores());
});

app.post('/tasks', (req, res) => {
  const { title, description } = req.body;
  
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  
  const task = new Task(title, description || '');
  tasks.push(task);
  
  broadcastTasks(); // Notify all clients
  res.status(201).json(task);
});

app.patch('/tasks/:id', (req, res) => {
  const task = tasks.find(t => t.id === req.params.id);
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  // Version conflict detection
  const clientVersion = req.body.version;
  if (clientVersion !== undefined && clientVersion !== task.version) {
    return res.status(409).json({ 
      error: 'Version conflict',
      current_version: task.version,
      current_task: task
    });
  }
  
  // Update task
  const previousStatus = task.status;
  Object.assign(task, req.body);
  task.updated_at = new Date();
  task.version += 1; // Increment version
  
  console.log(`✓ Task updated: ${task.title} (v${task.version})`);
  
  broadcastTasks();
  res.json(task);
});

app.delete('/tasks/:id', (req, res) => {
  const index = tasks.findIndex(t => t.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  tasks.splice(index, 1);
  broadcastTasks(); // Notify all clients
  res.status(204).send();
});

// Corruption Engine
function corruptStaleTasks() {
  const now = Date.now();

// Define stale threshold
// Testing (every 30 seconds)    : 30 * 1000
// Production (every 5 minutes)  : 5 * 60 * 1000
  const STALE_THRESHOLD = 30 * 1000;

  const staleTasks = tasks.filter(task => {
    const timeSinceUpdate = now - new Date(task.updated_at).getTime();
    return task.status === 'Doing' && timeSinceUpdate > STALE_THRESHOLD;
  });

  if (staleTasks.length === 0) return;

  const randomTask = staleTasks[Math.floor(Math.random() * staleTasks.length)];

  const corruptions = [
    (desc) => desc.split('').sort(() => Math.random() - 0.5).join(''),
    (desc) => desc.replace(/[aeiou]/gi, '█'),
    (desc) => desc.split('').map(c => Math.random() > 0.7 ? '?' : c).join(''),
    (desc) => `⚠️ CORRUPTED: ${desc.substring(0, 20)}...`,
    (desc) => desc.split(' ').reverse().join(' '),
  ];

  const corruptionMethod = corruptions[Math.floor(Math.random() * corruptions.length)];
  
  if (randomTask.description) {
    randomTask.description = corruptionMethod(randomTask.description);
    randomTask.corrupted = true;
    console.log(`🔥 Corrupted task: ${randomTask.title}`);
    
    broadcastTasks(); // Notify all clients immediately
  }
}

// Define corruption threshold
// Testing (every 10 seconds) : 10 * 1000
// Production (every minute)  : 60 * 1000
setInterval(corruptStaleTasks, 10 * 1000); 

// priority score updater (broadcasts every 2 seconds)
setInterval(() => {
  broadcastTasks();
}, 2000);

server.listen(3001, () => {
  console.log('✓ Server running on port 3001');
  console.log('✓ WebSocket server ready');
});