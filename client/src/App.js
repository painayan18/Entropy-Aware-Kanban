import './App.css';
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import ErrorBoundary from './ErrorBoundary';

const API_URL = 'http://localhost:3001';

function App() {
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState({ title: '', description: '' });
  const [isConnected, setIsConnected] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  
  const pendingUpdates = useRef(new Map());

  // WebSocket connection
  useEffect(() => {
    const socket = io(API_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    socket.on('connect', () => {
      console.log('✓ Connected to WebSocket');
      setIsConnected(true);
      setIsLoading(false);
    });

    socket.on('disconnect', () => {
      console.log('✗ Disconnected from WebSocket');
      setIsConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      setIsLoading(false);
    });

    socket.on('tasks_updated', (updatedTasks) => {
      setTasks(currentTasks => {
        return updatedTasks.map(serverTask => {
          if (pendingUpdates.current.has(serverTask.id)) {
            return pendingUpdates.current.get(serverTask.id);
          }
          return serverTask;
        });
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Create new task
  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;

    setIsCreating(true);

    try {
      await axios.post(`${API_URL}/tasks`, newTask);
      setNewTask({ title: '', description: '' });
    } catch (error) {
      console.error('Error creating task:', error);
      
      if (error.code === 'ERR_NETWORK') {
        alert('Network error: Cannot reach server. Please check your connection.');
      } else if (error.response?.status === 500) {
        alert('Server error: Failed to create task. Please try again.');
      } else {
        alert('Failed to create task. Please try again.');
      }
    } finally {
      setIsCreating(false);
    }
  };

  // Update task status with optimistic updates and conflict handling
  const handleStatusChange = async (taskId, newStatus) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Optimistic update
    const optimisticTask = { 
      ...task, 
      status: newStatus,
      updated_at: new Date()
    };
    
    setTasks(currentTasks =>
      currentTasks.map(t => t.id === taskId ? optimisticTask : t)
    );

    pendingUpdates.current.set(taskId, optimisticTask);

    try {
      await axios.patch(`${API_URL}/tasks/${taskId}`, {
        status: newStatus,
        version: task.version
      });

      pendingUpdates.current.delete(taskId);
      console.log(`✓ Task ${taskId} updated successfully`);

    } catch (error) {
      pendingUpdates.current.delete(taskId);

      if (error.response?.status === 409) {
        // Version conflict
        console.warn('⚠️ Version conflict detected');
        
        const serverTask = error.response.data.current_task;
        
        setTasks(currentTasks =>
          currentTasks.map(t => t.id === taskId ? serverTask : t)
        );

        const conflict = {
          id: Date.now(),
          taskTitle: task.title,
          attemptedStatus: newStatus,
          serverStatus: serverTask.status
        };
        
        setConflicts(prev => [...prev, conflict]);
        
        setTimeout(() => {
          setConflicts(prev => prev.filter(c => c.id !== conflict.id));
        }, 5000);

      } else if (error.response?.status === 500) {
        // Server error: rollback
        console.error('Server error:', error);
        setTasks(currentTasks =>
          currentTasks.map(t => t.id === taskId ? task : t)
        );
        alert('Server error: Changes reverted. Please try again.');
        
      } else if (error.code === 'ERR_NETWORK') {
        // Network error: rollback
        console.error('Network error:', error);
        setTasks(currentTasks =>
          currentTasks.map(t => t.id === taskId ? task : t)
        );
        alert('Network error: Cannot reach server. Changes reverted.');
        
      } else {
        // Other error: rollback
        console.error('Error updating task:', error);
        setTasks(currentTasks =>
          currentTasks.map(t => t.id === taskId ? task : t)
        );
        alert('Failed to update task. Changes reverted.');
      }
    }
  };

  // Delete task
  const handleDeleteTask = async (taskId) => {
    if (!window.confirm('Delete this task?')) return;

    const task = tasks.find(t => t.id === taskId);
    
    // Optimistic delete
    setTasks(currentTasks => currentTasks.filter(t => t.id !== taskId));

    try {
      await axios.delete(`${API_URL}/tasks/${taskId}`);
      console.log(`✓ Task ${taskId} deleted`);
    } catch (error) {
      console.error('Error deleting task:', error);
      // Restore task on error
      setTasks(currentTasks => [...currentTasks, task]);
      alert('Failed to delete task. Please try again.');
    }
  };

  const todoTasks = tasks.filter(t => t.status === 'Todo');
  const doingTasks = tasks.filter(t => t.status === 'Doing');
  const doneTasks = tasks.filter(t => t.status === 'Done');

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Connecting to Entropy Kanban...</p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="app">
        <header>
          <h1>🌀 Entropy-Aware Kanban</h1>
          <p>Tasks decay over time. Keep them moving!</p>
          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '🟢 Live' : '🔴 Disconnected'}
          </div>
        </header>

        <ConflictNotifications 
          conflicts={conflicts} 
          onDismiss={(id) => setConflicts(prev => prev.filter(c => c.id !== id))} 
        />

        <form onSubmit={handleCreateTask} className="task-form">
          <input
            type="text"
            placeholder="Task title"
            value={newTask.title}
            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
            disabled={isCreating}
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newTask.description}
            onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
            disabled={isCreating}
          />
          <button type="submit" disabled={isCreating}>
            {isCreating ? 'Adding...' : 'Add Task'}
          </button>
        </form>

        <div className="board">
          <Column
            title="📋 Todo"
            tasks={todoTasks}
            onStatusChange={handleStatusChange}
            onDelete={handleDeleteTask}
            targetStatus="Doing"
          />
          <Column
            title="⚡ Doing"
            tasks={doingTasks}
            onStatusChange={handleStatusChange}
            onDelete={handleDeleteTask}
            targetStatus="Done"
          />
          <Column
            title="✅ Done"
            tasks={doneTasks}
            onStatusChange={handleStatusChange}
            onDelete={handleDeleteTask}
            targetStatus={null}
          />
        </div>

        <footer className="app-footer">
          <p>Total tasks: {tasks.length} | Active: {doingTasks.length} | Completed: {doneTasks.length}</p>
        </footer>
      </div>
    </ErrorBoundary>
  );
}

function ConflictNotifications({ conflicts, onDismiss }) {
  if (conflicts.length === 0) return null;

  return (
    <div className="conflict-notifications">
      {conflicts.map(conflict => (
        <div key={conflict.id} className="conflict-notification">
          <span className="conflict-icon">⚠️</span>
          <div className="conflict-message">
            <strong>Conflict detected:</strong> "{conflict.taskTitle}" 
            <br />
            You tried to move to {conflict.attemptedStatus}, 
            but server had it as {conflict.serverStatus}
          </div>
          <button onClick={() => onDismiss(conflict.id)} className="dismiss-btn">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function Column({ title, tasks, onStatusChange, onDelete, targetStatus }) {
  return (
    <div className="column">
      <h2>{title} <span className="task-count">({tasks.length})</span></h2>
      <div className="task-list">
        {tasks.length === 0 ? (
          <div className="empty-column">No tasks here</div>
        ) : (
          tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              onMove={() => targetStatus && onStatusChange(task.id, targetStatus)}
              onDelete={() => onDelete(task.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, onMove, onDelete }) {
  const priorityScore = task.priority_score || 0;
  const isHighPriority = priorityScore > 0.0001;
  const isCorrupted = task.corrupted;

  return (
    <div
      className={`task-card ${isHighPriority ? 'high-priority' : ''} ${isCorrupted ? 'corrupted' : ''}`}
      style={{
        transform: isHighPriority ? `skewX(-${Math.min(priorityScore * 100000, 5)}deg)` : 'none'
      }}
    >
      {isCorrupted && <div className="corruption-badge">⚠️ CORRUPTED</div>}
      <h3>{task.title}</h3>
      <p>{task.description}</p>
      <div className="task-meta">
        <span>Volatility: {task.volatility_factor?.toFixed(2)}</span>
        <span>Score: {priorityScore.toFixed(6)}</span>
        <span>v{task.version}</span>
      </div>
      <div className="task-actions">
        {onMove && (
          <button onClick={onMove} className="move-btn">
            Move →
          </button>
        )}
        <button onClick={onDelete} className="delete-btn">
          🗑️
        </button>
      </div>
    </div>
  );
}

export default App;
