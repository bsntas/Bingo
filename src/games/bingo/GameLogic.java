package games.bingo;

import java.io.IOException;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.net.Socket;
import java.util.ArrayList;

public class GameLogic {

	private ArrayList<Player> players;
	private ArrayList<Player> templist;
	private Player winner;
	private Generator generator;
	private boolean started= false;
	private static final int MAX_PLAYERS= 5;
	private int turn;
	private boolean ready= false;
	
	public GameLogic() {
		generator= new Generator();
		players= new ArrayList<Player>();
		templist= new ArrayList<Player>();
	}
	
	private void sendToAll (ServerMessage msg) {
		for (Player p : players) {
			p.sendMessage(msg);
		}
	}

	String addPlayer(Socket s) {
		if(started) return "Game already started";
		synchronized (players) {
			if(players.size() + templist.size() == MAX_PLAYERS) return "Maximum number of players reached";
		}
		Player newPlayer= null;
		try {
			newPlayer = new Player(s);
		} catch (IOException e) {
			return "Internal Error";
		}
		synchronized (players) { templist.add(newPlayer); }
		return null;
	}

	private String installHost(Player player) {
		synchronized (players) {
			for (Player p: players)
				if (p.isHost()) return "Sorry, host already exists.";
			for (Player p: templist)
				if (p.isHost()) return "Sorry, host already exists.";
		}
		player.host= true;
		initClient(player);
		return null;
	}
	
	private String initClient(Player newp) {
		synchronized (players) {
			if (!templist.contains(newp)) return "Player registration error";

			for (Player p: players) {
				if (p.name.equals(newp.name)) return "Player name already existing, try again with new name";
			}

			int[][] newkit= generator.getNewKit();
			newp.setKit(newkit);

			//send kit
			ServerMessage msg= new ServerMessage(ServerMessage.Type.KIT,newkit);
			newp.sendMessage(msg);

			//send all previously joined player names
			ArrayList<String> allplayers= new ArrayList<String>();
			for (Player p: players) allplayers.add(p.name);
			msg= new ServerMessage(ServerMessage.Type.ALL_PLAYERS,allplayers);
			newp.sendMessage(msg);
			players.add(newp);
			templist.remove(newp);

			msg= new ServerMessage(ServerMessage.Type.ADD_PLAYER,newp.name);
			sendToAll(msg);

			return null;
		}
	}
	
	private String startGame(Player p) {
		if (started) return "Error: Game already started";
		if (!p.isHost()) return "You are not host, so you cannot start the game";
		
		started= true;
		turn= 0;
		ready= true;
		
		//send started message to all players with the name of the player having the first turn
		ServerMessage msg= new ServerMessage(ServerMessage.Type.GAME_STARTED,players.get(turn).name);
		sendToAll(msg);
		
		return null;
	}

	public String commitall(int n) {
		if (!started) return "Game not started, Host is waiting for new players";
		if (!ready) return "Updating game state, try again...";
		if (winner != null) return "Sorry, game over. Won by " + winner.name;
		ready= false;
		ServerMessage comsg= new ServerMessage(ServerMessage.Type.COMMIT, new Integer(n));
		sendToAll(comsg);
		
		for (Player p: players) {
			p.commit(n);
			p.updateScore();
		}
		if (winner != null) {
			ServerMessage gameup= new ServerMessage(ServerMessage.Type.GAME_OVER,winner.name);
			sendToAll(gameup);
			ready= true; // to provide appropriate for client who commit later
			for (Player p : players) p.close();
			return null;
		}

		turn= (turn + 1) % players.size();
		ServerMessage msg= new ServerMessage(ServerMessage.Type.TURN,players.get(turn).name);
		sendToAll(msg);
		ready= true;
		return null;
	}
	
	public void withdraw(Player p) {
		if (winner != null) return;
		ServerMessage removemsg= new ServerMessage(ServerMessage.Type.REMOVE_PLAYER,p.name);
		if(!started) {
			synchronized (players) {
				boolean registered= players.remove(p);
				if (!registered){
					templist.remove(p);
					return;
				}
				sendToAll(removemsg);
			}
		} else {
			ready= false;
			int ind= players.lastIndexOf(p);
			templist.remove(p);
			sendToAll(removemsg);
			if (ind < turn) {
				turn--;
			} else if (ind == turn) { //turn as number does not change
				ServerMessage turnmsg= new ServerMessage(ServerMessage.Type.TURN,players.get(turn).name);
				sendToAll(turnmsg);
			} //no change in turn if index is greater than turn
			ready= true;
		}
	}

	public String stop(Player player) {
		if (!player.isHost()) return "You are not the host. You cannot stop the server!!!";
		ServerMessage msg= new ServerMessage(ServerMessage.Type.EXIT,"Host is going offline");
		sendToAll(msg);
		System.exit(3);
		return null;
	}
	
	class Player implements Runnable {
		
		private Socket socket;
		private ObjectOutputStream outs;
		private String name;
		private int[][] kit;
		private boolean[][] state;
		private int score;
		private boolean host;
		
		public Player(Socket s) throws IOException {
			socket= s;
			outs= new ObjectOutputStream(s.getOutputStream());
			new Thread(this).start();
			state= new boolean[5][5];
		}
		
		public void close () {
			try {
				socket.close();
			} catch (IOException e) {
				System.out.println ("Unable to close socket for player " + name);
			}
		}
		
		public Socket getSocket() {
			return socket;
		}
		
		public String getName() {
			return name;
		}
		
		public int[][] getKit() {
			return kit;
		}

		private void setKit(int[][] kit) {
			this.kit = kit;
		}

		public int getScore() {
			return score;
		}

		public boolean isHost() {
			return host;
		}
		
		private void commit(int num) {
			for (int i= 0; i < 5; i++)
				for (int j= 0; j < 5; j++)
					if (kit[i][j] == num) {
						state[i][j]= true;
					}
		}
		
		private void updateScore () {
			boolean found= false;
			int newscore= 0;
			//check rows
			for (int i= 0; i < 5; i++) {
				found= true;
				for (int j= 0; j < 5; j++)
					if (!state[i][j]) {
						found= false;
						break;
					}
				if(found) newscore++;
			}
			//check columns
			for (int i= 0; i < 5; i++) {
				found= true;
				for (int j= 0; j < 5; j++)
					if (!state[j][i]) {
						found= false;
						break;
					}
				if(found) newscore++;
			}
			//check one diagonal
			found= true;
			for (int i= 0; i < 5; i++) {
				if (!state[i][i]) {
					found= false;
					break;
				}
			}
			if (found) newscore++;
			//check other diagonal
			found= true;
			for (int i= 0; i < 5; i++) {
				if (!state[i][4-i]) {
					found= false;
					break;
				}
			}
			if (found) newscore++;
			
			if (score != newscore) {
				ServerMessage scoreupdate= new ServerMessage(ServerMessage.Type.SCORE_UPDATE,new Integer(newscore));
				sendMessage(scoreupdate);
			}
			score= newscore;
			//check game over
			if (score >= 5) winner= this;
		}

		@Override
		public void run() {
			ObjectInputStream objins= null;
			try {
				objins= new ObjectInputStream (socket.getInputStream());
			} catch (IOException e) { 
				System.out.println ("Unable to open objectinputstream for new player " + name + ". "
						+ "Terminating thread.");
				return; 
			}
			Object message= null;
			while(!socket.isClosed()) {
				try {
					message= objins.readObject();
				} catch (ClassNotFoundException | IOException e) {
					System.out.println ("Error in reading from socket. Terminating thread.");
					return;
				}
				processMessage((ClientMessage) message);
			}
		}
		
		public boolean sendMessage(ServerMessage msg) {
			try {
				outs.writeObject(msg);
				outs.flush();
			} catch (IOException e) {
				return false;
			}
			return true;
		}
		
		private void processMessage(ClientMessage msg) {
			String resp = null;
			switch (msg.getType()) {
			case HOST:
				name= (String) msg.getMessage();
				resp= installHost(this);
				break;
			case JOIN:
				name= (String) msg.getMessage();
				resp= initClient(this);
				break;
			case COMMIT:
				int n= (Integer) msg.getMessage();
				resp= commitall(n);
				break;
			case WITHDRAW:
				withdraw(this);
				break;
			case START:
				resp= startGame(this);
				break;
			case STOP_SERVER:
				resp= stop(this);
				break;
			default:
				break;
			}
			//send back response message on exceptional cases
			if (resp != null) {
				ServerMessage rm= new ServerMessage(ServerMessage.Type.ALERT,resp);
				sendMessage(rm);
			}
		}
	}
}
