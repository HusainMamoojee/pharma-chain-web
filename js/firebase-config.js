import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";



const firebaseConfig = {

  apiKey: "AIzaSyD1g3z7h30NqhA9GwER7UjsELXVxXnXdiY",
  authDomain: "pharma-chain-e4cc2.firebaseapp.com",
  projectId: "pharma-chain-e4cc2",
  storageBucket: "pharma-chain-e4cc2.firebasestorage.app",
  messagingSenderId: "277246561904",
  appId: "1:277246561904:web:ab358cc52b089d7e7e2eb5"
};


//initialize Firebase
const app = initializeApp(firebaseConfig);


//exporting the services to other files that need firebase services
export const db = getFirestore(app);
export const auth = getAuth(app);



export { firebaseConfig };