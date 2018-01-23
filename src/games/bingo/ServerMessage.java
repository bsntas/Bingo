package games.bingo;

import java.io.Serializable;

public class ServerMessage implements Serializable {
	private static final long serialVersionUID = 1L;
	private Type type;
	private Object message;
	
	public Object getMessage() {
		return message;
	}
	
	public Type getType() {
		return type;
	}
	
	public ServerMessage(Type t, Object message) {
		type= t;
		this.message= message;
	}
	
	enum Type {
		ALERT, EXIT, COMMIT, ADD_PLAYER, REMOVE_PLAYER, TURN, KIT, 
		ALL_PLAYERS, GAME_STARTED, GAME_OVER, SCORE_UPDATE;
	}
}

