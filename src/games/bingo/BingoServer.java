package games.bingo;

import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;

public class BingoServer implements Runnable {
	
	private static final int SERVER_PORT= 55555;
	private ServerSocket server;
	private GameLogic logic;
	
	public BingoServer() throws IOException {
		server= new ServerSocket(SERVER_PORT);
		logic= new GameLogic();
	}
	
	public void start() {
		new Thread(this).start();
	}

	@Override
	public void run() {
		while(!server.isClosed()) {
			Socket newplayer= null;
			try {
				newplayer= server.accept();
				logic.addPlayer(newplayer);
			} catch (IOException e) {
				System.out.println ("Error in installing new player. Reason: " + e.getMessage());
			}
		}
	}
	
	public static void main(String[] args) {
		BingoServer server = null;
		try {
			server = new BingoServer();
		} catch (IOException e) {
			System.out.println ("Opening server socket failed. Sorry, quitting with reason: " + e.getMessage());
			System.exit(1);
		}
		server.start();
	}
}
