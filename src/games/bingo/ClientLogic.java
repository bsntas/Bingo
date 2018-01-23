package games.bingo;

import java.util.ArrayList;

import javax.swing.JOptionPane;

public class ClientLogic {
	
	private Communicator comm;
	private String myName;
	private String turn;
	private boolean started;
	private ConfigurePanel config;
	private BingoPanel bingoPanel;
	private int[][] kit;
	
	void setCommunicator (Communicator c) {
		comm= c;
	}
	
	public ClientLogic(String name) {
		myName= name;
	}

	public void takeOver(StartPanel p) {
		config= new ConfigurePanel(this);
		ClientMessage join;
		if (p.getRole().equals(Role.HOST)) {
			join= new ClientMessage(ClientMessage.Type.HOST, myName);
			config.setHost();
		} else {
			join= new ClientMessage(ClientMessage.Type.JOIN, myName);
		}
		Main.instance.show(config);
		// send initial join message to server
		comm.sendMessage(join);
	}

	private void startGame(String turn) {
		this.turn= turn;
		String[] players= config.getPlayerNames();
		bingoPanel= new BingoPanel(kit, players,this);
		started= true;
		Main.instance.show(bingoPanel);
		bingoPanel.setTurn(turn);
	}

	private void setGameOver(String winner) {
		Main.instance.show(bingoPanel.getGameoverPanel(myName, winner));
	}
	
	void sendStartGameMessage() {
		ClientMessage startGame= new ClientMessage(ClientMessage.Type.START,myName);
		comm.sendMessage(startGame);
	}
	
	void processMessage(ServerMessage msg) {
		switch (msg.getType()) {
		case KIT:
			kit= (int[][]) msg.getMessage();
			break;
		case ALL_PLAYERS:
			@SuppressWarnings("unchecked")
			ArrayList<String> players= (ArrayList<String>) msg.getMessage();
			for (String player: players) config.addPlayer(player);
			break;
		case ADD_PLAYER:
			String player= (String)msg.getMessage();
			config.addPlayer(player);
			break;
		case REMOVE_PLAYER:
			String plyr= (String) msg.getMessage();
			config.removePlayer(plyr);
			break;
		case GAME_STARTED:
			String trn= (String) msg.getMessage();
			startGame(trn);
			break;
		case COMMIT:
			int n= (int) msg.getMessage();
			bingoPanel.commit(n);
			break;
		case SCORE_UPDATE:
			int score= (int) msg.getMessage();
			bingoPanel.updateScore(score);
			break;
		case TURN:
			String newturn= (String) msg.getMessage();
			this.turn= newturn;
			bingoPanel.setTurn(newturn);
			break;
		case GAME_OVER:
			String winner= (String) msg.getMessage();
			setGameOver(winner);
			break;
		case ALERT:
			String msgstr= (String)msg.getMessage();
			JOptionPane.showMessageDialog(null, msgstr);
			break;
		case EXIT:
			String errstr= (String)msg.getMessage();
			JOptionPane.showMessageDialog(null, "Server stopped with message: " + errstr);
			System.exit(2);
			break;
		default: break;
		}
	}

	public boolean commit(int num) {
		if (!started || !turn.equals(myName)) return false;
		ClientMessage commitmsg= new ClientMessage(ClientMessage.Type.COMMIT, new Integer(num));
		comm.sendMessage(commitmsg);
		return true;
	}

	public void withdraw() {
		ClientMessage msg= new ClientMessage(ClientMessage.Type.WITHDRAW,null);
		comm.sendMessage(msg);
	}
	
	public void stopServer() {
		ClientMessage msg= new ClientMessage(ClientMessage.Type.STOP_SERVER,null);
		comm.sendMessage(msg);
	}
}
