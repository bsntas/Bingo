package games.bingo;

import java.io.IOException;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.net.Socket;

public class Communicator implements Runnable {
	
	private Socket socket;
	private ObjectInputStream objins;
	private ObjectOutputStream objout;
	private ClientLogic logic;
	private static final int SERVER_PORT= 55555;
	
	void setLogic (ClientLogic l) {
		logic= l;
	}
	
	public Communicator(String remotehost) throws IOException {
		socket= new Socket(remotehost, SERVER_PORT);
		objins= new ObjectInputStream(socket.getInputStream());
		objout= new ObjectOutputStream(socket.getOutputStream());
		new Thread(this).start();
	}
	
	@Override
	public void run() {
		while (!socket.isClosed()) {
			ServerMessage msg= null;
			try {
				msg= (ServerMessage) objins.readObject();
			} catch (ClassNotFoundException | IOException e) {
				System.out.println ("Error in reading server message " + e.getMessage());
				System.out.println ("Terminating read thread...");
				return;
			}
			System.out.println ("From server of type: " + msg.getType());
			logic.processMessage(msg);
		}
	}
	
	void sendMessage(ClientMessage msg) {
		try {
			objout.writeObject(msg);
			objout.flush();
		} catch (IOException e) {
			System.out.println ("Unable to send message of type: " + msg.getType());
		}
	}
}
