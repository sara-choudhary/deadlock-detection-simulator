/*
 * samples.js: example INPUTS the user can load and then edit.
 *
 * Only inputs live here. No sample carries a stored answer: every result
 * shown on the page comes from the server (POST /api/detect).
 *
 * Keep the list below valid JSON (double quotes, no trailing commas, no
 * comments inside it): tests/test_frontend.py reads it back and checks every
 * sample against the real algorithm.
 */
window.DEADLOCK_SAMPLES = [
  {
    "id": "deadlock-with-independent",
    "name": "Two processes deadlocked, one independent",
    "description": "P1 and P2 each hold a resource the other needs. P3 asks for nothing, so it finishes by itself, but that does not help P1 or P2.",
    "process_count": 3,
    "resource_count": 3,
    "available": [0, 0, 0],
    "allocation": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    "request": [[0, 1, 0], [1, 0, 0], [0, 0, 0]]
  },
  {
    "id": "all-finish",
    "name": "Every process can finish",
    "description": "One free instance of each resource is enough for P1 to finish. Its release then lets P2 finish.",
    "process_count": 2,
    "resource_count": 2,
    "available": [1, 1],
    "allocation": [[1, 0], [0, 1]],
    "request": [[0, 1], [1, 0]]
  },
  {
    "id": "release-chain",
    "name": "One process finishing frees another",
    "description": "P2 cannot go first: it needs 2 of R2 and none are free. P1 can finish, and the 2 instances of R2 it releases are what allow P2 to finish.",
    "process_count": 2,
    "resource_count": 2,
    "available": [1, 0],
    "allocation": [[0, 2], [1, 0]],
    "request": [[1, 0], [0, 2]]
  },
  {
    "id": "textbook-five-processes",
    "name": "Five processes, three resource types",
    "description": "A textbook-style system with several instances of each resource. Every process can finish. The trace shows P2 has to wait until P3 has released what it holds.",
    "process_count": 5,
    "resource_count": 3,
    "available": [0, 0, 0],
    "allocation": [[0, 1, 0], [2, 0, 0], [3, 0, 3], [2, 1, 1], [0, 0, 2]],
    "request": [[0, 0, 0], [2, 0, 2], [0, 0, 0], [1, 0, 0], [0, 0, 2]]
  },
  {
    "id": "multi-resource-deadlock",
    "name": "Five processes, four of them stuck",
    "description": "The same system as the previous sample, except P3 now also asks for 1 instance of R3. After P1 finishes, nothing that is free is enough for P2 to P5.",
    "process_count": 5,
    "resource_count": 3,
    "available": [0, 0, 0],
    "allocation": [[0, 1, 0], [2, 0, 0], [3, 0, 3], [2, 1, 1], [0, 0, 2]],
    "request": [[0, 0, 0], [2, 0, 2], [0, 0, 1], [1, 0, 0], [0, 0, 2]]
  },
  {
    "id": "zero-allocation-edge",
    "name": "A process that holds nothing",
    "description": "P2 holds no resources, so it cannot be blocking anyone and counts as finished from the start, even though its request could never be met. P1 and P3 wait on each other.",
    "process_count": 3,
    "resource_count": 2,
    "available": [0, 0],
    "allocation": [[1, 0], [0, 0], [0, 1]],
    "request": [[0, 1], [5, 5], [1, 0]]
  }
];
