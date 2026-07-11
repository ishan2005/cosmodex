import { McqQuestion } from '../types/index.js';
import crypto from 'crypto';

/**
 * Curated programming & coding MCQ question bank.
 * Categories: Data Structures, Algorithms, OOP, Web Dev, Databases, Languages, OS, Networking.
 * Each match picks 10 random questions from this pool.
 */

function q(question: string, options: string[], correctIndex: number, difficulty: 'easy' | 'medium' | 'hard', category: string): McqQuestion {
  return { id: crypto.randomUUID(), question, options, correctIndex, difficulty, category };
}

export const CODING_QUESTIONS: McqQuestion[] = [
  // ── Data Structures ─────────────────────────────────────────────
  q('What is the time complexity of searching in a balanced Binary Search Tree?',
    ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], 1, 'easy', 'Data Structures'),

  q('Which data structure uses FIFO (First In, First Out) ordering?',
    ['Stack', 'Queue', 'Tree', 'Graph'], 1, 'easy', 'Data Structures'),

  q('Which data structure uses LIFO (Last In, First Out) ordering?',
    ['Queue', 'Linked List', 'Stack', 'Hash Map'], 2, 'easy', 'Data Structures'),

  q('What is the worst-case time complexity of inserting into a hash table?',
    ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], 2, 'medium', 'Data Structures'),

  q('Which data structure is best for implementing a priority queue?',
    ['Array', 'Linked List', 'Heap', 'Stack'], 2, 'medium', 'Data Structures'),

  q('In a singly linked list, what is the time complexity of deleting the last node?',
    ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], 2, 'easy', 'Data Structures'),

  q('What is the maximum number of children a node can have in a binary tree?',
    ['1', '2', '3', 'Unlimited'], 1, 'easy', 'Data Structures'),

  q('Which data structure is used in BFS (Breadth-First Search)?',
    ['Stack', 'Queue', 'Heap', 'Array'], 1, 'easy', 'Data Structures'),

  q('Which data structure is used in DFS (Depth-First Search)?',
    ['Queue', 'Stack', 'Heap', 'Hash Map'], 1, 'easy', 'Data Structures'),

  q('What is a Trie data structure primarily used for?',
    ['Sorting numbers', 'String/prefix searching', 'Graph traversal', 'Memory management'], 1, 'medium', 'Data Structures'),

  q('What is the space complexity of an adjacency matrix for a graph with V vertices?',
    ['O(V)', 'O(V²)', 'O(V + E)', 'O(E)'], 1, 'medium', 'Data Structures'),

  q('Which self-balancing BST guarantees O(log n) operations?',
    ['Binary Tree', 'Linked List', 'AVL Tree', 'Array'], 2, 'medium', 'Data Structures'),

  // ── Algorithms ──────────────────────────────────────────────────
  q('What is the time complexity of Merge Sort?',
    ['O(n)', 'O(n log n)', 'O(n²)', 'O(log n)'], 1, 'easy', 'Algorithms'),

  q('What is the worst-case time complexity of Quick Sort?',
    ['O(n log n)', 'O(n)', 'O(n²)', 'O(log n)'], 2, 'medium', 'Algorithms'),

  q('Which algorithm technique does Binary Search use?',
    ['Greedy', 'Divide and Conquer', 'Dynamic Programming', 'Backtracking'], 1, 'easy', 'Algorithms'),

  q('What is the time complexity of the Dijkstra\'s algorithm using a min-heap?',
    ['O(V²)', 'O(V + E)', 'O((V + E) log V)', 'O(E log E)'], 2, 'hard', 'Algorithms'),

  q('Which sorting algorithm has the best worst-case time complexity?',
    ['Quick Sort', 'Bubble Sort', 'Merge Sort', 'Selection Sort'], 2, 'medium', 'Algorithms'),

  q('What is memoization in Dynamic Programming?',
    ['Sorting data first', 'Caching results of subproblems', 'Using extra memory for speed', 'A type of recursion'], 1, 'medium', 'Algorithms'),

  q('Which algorithm is used to find the shortest path in an unweighted graph?',
    ['DFS', 'BFS', 'Dijkstra\'s', 'Floyd-Warshall'], 1, 'easy', 'Algorithms'),

  q('What is the time complexity of Bubble Sort in the worst case?',
    ['O(n)', 'O(n log n)', 'O(n²)', 'O(1)'], 2, 'easy', 'Algorithms'),

  q('Kadane\'s algorithm is used to solve which problem?',
    ['Longest Common Subsequence', 'Maximum Subarray Sum', 'Shortest Path', 'Minimum Spanning Tree'], 1, 'medium', 'Algorithms'),

  q('Which approach does the Knapsack problem use for an optimal solution?',
    ['Greedy', 'Dynamic Programming', 'Divide and Conquer', 'Brute Force'], 1, 'medium', 'Algorithms'),

  q('What is the time complexity of finding an element in a sorted array using Binary Search?',
    ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], 1, 'easy', 'Algorithms'),

  q('In the Two Pointer technique, how many pointers are typically used?',
    ['1', '2', '3', '4'], 1, 'easy', 'Algorithms'),

  // ── OOP & Design ────────────────────────────────────────────────
  q('Which OOP principle allows a class to inherit from another class?',
    ['Encapsulation', 'Polymorphism', 'Inheritance', 'Abstraction'], 2, 'easy', 'OOP'),

  q('What is polymorphism in OOP?',
    ['Hiding internal details', 'Objects taking many forms', 'Code reuse via inheritance', 'Grouping related data'], 1, 'easy', 'OOP'),

  q('What does the SOLID "S" stand for?',
    ['Simple Responsibility', 'Single Responsibility', 'Structured Responsibility', 'Standard Responsibility'], 1, 'medium', 'OOP'),

  q('Which design pattern ensures a class has only one instance?',
    ['Factory', 'Observer', 'Singleton', 'Strategy'], 2, 'easy', 'OOP'),

  q('What is the difference between an abstract class and an interface?',
    ['No difference', 'Abstract classes can have implementations', 'Interfaces can have state', 'Abstract classes are faster'], 1, 'medium', 'OOP'),

  q('What does encapsulation mean in OOP?',
    ['Code inheritance', 'Bundling data and methods together', 'Multiple inheritance', 'Method overloading'], 1, 'easy', 'OOP'),

  q('Which pattern is used to create objects without specifying exact classes?',
    ['Singleton', 'Factory', 'Observer', 'Decorator'], 1, 'medium', 'OOP'),

  q('What is method overloading?',
    ['Overriding parent method', 'Same method name, different parameters', 'Calling method repeatedly', 'Async method execution'], 1, 'easy', 'OOP'),

  // ── Web Development ─────────────────────────────────────────────
  q('What does REST stand for?',
    ['Remote Execution Standard Technology', 'Representational State Transfer', 'Rapid Endpoint Service Tool', 'Request-Event State Trigger'], 1, 'easy', 'Web Dev'),

  q('Which HTTP method is used to update an existing resource?',
    ['GET', 'POST', 'PUT', 'DELETE'], 2, 'easy', 'Web Dev'),

  q('What status code indicates "Not Found"?',
    ['200', '301', '404', '500'], 2, 'easy', 'Web Dev'),

  q('What does CORS stand for?',
    ['Cross-Origin Resource Sharing', 'Client-Origin Request Service', 'Common Object Resource System', 'Cross-Object Rendering Standard'], 0, 'medium', 'Web Dev'),

  q('Which HTTP status code means "Internal Server Error"?',
    ['400', '403', '404', '500'], 3, 'easy', 'Web Dev'),

  q('What is the purpose of a JWT token?',
    ['Database query optimization', 'Stateless authentication', 'CSS styling', 'File compression'], 1, 'medium', 'Web Dev'),

  q('What does the "Content-Type: application/json" header indicate?',
    ['The server is down', 'The request/response body is JSON', 'The page is cached', 'The connection is encrypted'], 1, 'easy', 'Web Dev'),

  q('Which WebSocket event fires when a connection is established?',
    ['onmessage', 'onerror', 'onopen', 'onclose'], 2, 'medium', 'Web Dev'),

  q('What is the default port for HTTPS?',
    ['80', '8080', '443', '3000'], 2, 'easy', 'Web Dev'),

  q('What does SSR stand for in web development?',
    ['Server-Side Rendering', 'Static Site Routing', 'Secure Socket Relay', 'Standard Service Request'], 0, 'medium', 'Web Dev'),

  // ── Databases & SQL ─────────────────────────────────────────────
  q('Which SQL keyword is used to retrieve data from a database?',
    ['INSERT', 'UPDATE', 'SELECT', 'DELETE'], 2, 'easy', 'Databases'),

  q('What does ACID stand for in databases?',
    ['Atomicity, Consistency, Isolation, Durability', 'Access, Control, Identity, Data', 'Automated, Cached, Indexed, Distributed', 'Async, Concurrent, Isolated, Durable'], 0, 'medium', 'Databases'),

  q('Which type of JOIN returns only matching rows from both tables?',
    ['LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN'], 2, 'easy', 'Databases'),

  q('What is a primary key?',
    ['A foreign reference', 'A unique identifier for each row', 'An index type', 'A stored procedure'], 1, 'easy', 'Databases'),

  q('What does the SQL GROUP BY clause do?',
    ['Sorts rows', 'Groups rows by column values for aggregation', 'Filters groups', 'Joins tables'], 1, 'medium', 'Databases'),

  q('Which NoSQL database is document-oriented?',
    ['Redis', 'MongoDB', 'Cassandra', 'Neo4j'], 1, 'easy', 'Databases'),

  q('What is database normalization?',
    ['Making database faster', 'Reducing data redundancy', 'Adding more indexes', 'Encrypting data'], 1, 'medium', 'Databases'),

  q('What SQL keyword filters results after GROUP BY?',
    ['WHERE', 'HAVING', 'FILTER', 'LIMIT'], 1, 'medium', 'Databases'),

  // ── Programming Languages ───────────────────────────────────────
  q('Which keyword is used to define a function in Python?',
    ['function', 'func', 'def', 'fn'], 2, 'easy', 'Languages'),

  q('What is the output of: console.log(typeof null) in JavaScript?',
    ['"null"', '"undefined"', '"object"', '"boolean"'], 2, 'easy', 'Languages'),

  q('What does "===" mean in JavaScript?',
    ['Assignment', 'Loose equality', 'Strict equality (type + value)', 'Not equal'], 2, 'easy', 'Languages'),

  q('Which language is known for "Write Once, Run Anywhere"?',
    ['Python', 'C++', 'Java', 'JavaScript'], 2, 'easy', 'Languages'),

  q('What is a closure in JavaScript?',
    ['A loop construct', 'A function with access to its outer scope', 'An error handler', 'A CSS feature'], 1, 'medium', 'Languages'),

  q('What does "const" mean in JavaScript?',
    ['Variable can be reassigned', 'Variable reference cannot be reassigned', 'Variable is deleted after use', 'Variable is global'], 1, 'easy', 'Languages'),

  q('What is the difference between "let" and "var" in JavaScript?',
    ['No difference', 'let is block-scoped, var is function-scoped', 'var is block-scoped, let is function-scoped', 'let is faster'], 1, 'medium', 'Languages'),

  q('What does "async/await" do in JavaScript?',
    ['Makes code run faster', 'Handles asynchronous operations synchronously-style', 'Creates threads', 'Compiles TypeScript'], 1, 'medium', 'Languages'),

  q('In Python, what does "self" refer to in a class method?',
    ['The class itself', 'The current instance of the class', 'A global variable', 'The parent class'], 1, 'easy', 'Languages'),

  q('What is TypeScript?',
    ['A database language', 'A superset of JavaScript with static types', 'A CSS framework', 'A testing library'], 1, 'easy', 'Languages'),

  q('What is the output of: print(2 ** 3) in Python?',
    ['6', '8', '9', '5'], 1, 'easy', 'Languages'),

  q('What does the "map()" function do in JavaScript?',
    ['Filters elements', 'Creates a new array by transforming each element', 'Sorts an array', 'Finds an element'], 1, 'easy', 'Languages'),

  // ── Git & Version Control ──────────────────────────────────────
  q('What command creates a new Git branch?',
    ['git branch new-branch', 'git new branch', 'git create branch', 'git init branch'], 0, 'easy', 'Git'),

  q('What does "git merge" do?',
    ['Deletes a branch', 'Combines two branches', 'Creates a commit', 'Reverts changes'], 1, 'easy', 'Git'),

  q('What is a Git "pull request"?',
    ['Downloading code', 'A request to merge changes into a branch', 'Deleting a repository', 'Creating a new branch'], 1, 'easy', 'Git'),

  q('What does "git stash" do?',
    ['Deletes uncommitted changes', 'Temporarily saves uncommitted changes', 'Creates a branch', 'Pushes code'], 1, 'medium', 'Git'),

  q('What is the difference between "git fetch" and "git pull"?',
    ['No difference', 'fetch downloads, pull downloads + merges', 'pull downloads, fetch downloads + merges', 'fetch is faster'], 1, 'medium', 'Git'),

  // ── System Design & Concepts ────────────────────────────────────
  q('What is the purpose of a load balancer?',
    ['Store data', 'Distribute traffic across servers', 'Encrypt data', 'Manage databases'], 1, 'medium', 'System Design'),

  q('What does CDN stand for?',
    ['Central Data Network', 'Content Delivery Network', 'Cloud Database Node', 'Compute Distribution Network'], 1, 'easy', 'System Design'),

  q('What is caching used for?',
    ['Permanent data storage', 'Speeding up data retrieval', 'Deleting old data', 'Network routing'], 1, 'easy', 'System Design'),

  q('What is the CAP theorem?',
    ['A sorting algorithm', 'Consistency, Availability, Partition tolerance tradeoff', 'A design pattern', 'A security protocol'], 1, 'hard', 'System Design'),

  q('What is a microservice architecture?',
    ['One large application', 'Small independent services communicating via APIs', 'A frontend framework', 'A database design'], 1, 'medium', 'System Design'),

  q('What is rate limiting?',
    ['Speeding up requests', 'Restricting the number of requests in a time window', 'Caching responses', 'Load balancing'], 1, 'medium', 'System Design'),

  q('What is the time complexity notation called?',
    ['Omega notation', 'Theta notation', 'Big O notation', 'Lambda notation'], 2, 'easy', 'Algorithms'),

  q('What is recursion?',
    ['A loop construct', 'A function calling itself', 'A sorting method', 'An error type'], 1, 'easy', 'Algorithms'),

  q('What is a race condition?',
    ['A fast algorithm', 'When two threads access shared data simultaneously causing bugs', 'A type of sort', 'A network protocol'], 1, 'hard', 'System Design'),

  q('What is Docker used for?',
    ['Version control', 'Containerizing applications', 'Database management', 'Frontend styling'], 1, 'medium', 'System Design'),
];

/**
 * Pick N random questions from the bank, shuffled.
 */
export function pickRandomQuestions(count: number): McqQuestion[] {
  const shuffled = [...CODING_QUESTIONS].sort(() => Math.random() - 0.5);
  // Return fresh copies with new IDs so each match has unique question IDs
  return shuffled.slice(0, Math.min(count, shuffled.length)).map(q => ({
    ...q,
    id: crypto.randomUUID(),
  }));
}
