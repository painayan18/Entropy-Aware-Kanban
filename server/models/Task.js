class Task {
  constructor(title, description) {
    this.id = Date.now().toString() + Math.random();
    this.title = title;
    this.description = description;
    this.status = 'Todo';
    this.created_at = new Date();
    this.updated_at = new Date();
    this.volatility_factor = Math.random() * 0.9 + 0.1;
    this.deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    this.version = 0;
  }
}

module.exports = Task;