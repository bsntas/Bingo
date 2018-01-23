package games.bingo;

import java.io.Serializable;

public class ClientMessage implements Serializable {
	private static final long serialVersionUID = 1L;
	private Type type;
	private Object message;

	public Object getMessage() {
		return message;
	}

	public Type getType() {
		return type;
	}

	public ClientMessage(Type t, Object message) {
		type= t;
		this.message= message;
	}

	enum Type {
		HOST, JOIN, COMMIT, WITHDRAW, START, STOP_SERVER;
	}
}
