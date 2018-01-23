package games.bingo;

import java.awt.Dimension;
import java.awt.EventQueue;
import java.awt.Point;
import java.awt.Toolkit;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.File;
import java.io.IOException;

import javax.swing.JFrame;
import javax.swing.JPanel;
import javax.swing.UIManager;
import javax.swing.UnsupportedLookAndFeelException;

public class Main {
	
	private static final int FRAME_WIDTH= 400;
	private static final int FRAME_HEIGHT= 300;
	private JFrame frame;
	private JPanel previous;
	static Main instance;
	private Process serverProcess;
	private ClientLogic logic;

	public void setClientLogicRefernce(ClientLogic cl) {
		logic= cl;
	}
	
	public Main() {
		try {
			UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
		} catch (ClassNotFoundException | InstantiationException
				| IllegalAccessException | UnsupportedLookAndFeelException e) {
			//do nothing
		}
		
		frame= new JFrame();
		frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
		Dimension screenSize= Toolkit.getDefaultToolkit().getScreenSize();
		frame.setSize(new Dimension(FRAME_WIDTH,
				FRAME_HEIGHT));
		frame.setLocation(new Point((screenSize.width-FRAME_WIDTH)/2,(screenSize.height-FRAME_HEIGHT)/2));
		frame.addWindowListener(new WindowAdapter() {
			public void windowClosing (WindowEvent e) {
				if (serverProcess != null) {
					logic.stopServer();
				} else { logic.withdraw(); }
			}
		});
		frame.setResizable(false);
	}
	
	public void startServer () {
		String[] cmd= {"java", "games.bingo.BingoServer"};
		String workingDir= System.getProperty("user.dir");
		try {
			serverProcess= Runtime.getRuntime().exec(cmd,null,new File(workingDir + "/bin"));
		} catch (IOException e) {
			System.out.println ("Could not start server. Reason: " + e.getMessage());
		}
	}
	
	public void show (final JPanel p) {
		EventQueue.invokeLater(new Runnable() {
			@Override
			public void run() {
				frame.setTitle(p.getName());
				if(previous != null) {
					frame.remove(previous);
				}
				frame.add(p);
				previous= p;
				frame.revalidate();
				frame.setVisible(true);
			}
		});
	}
	
	public void hide() {
		frame.setVisible(false);
	}
	
	public static void main(String[] args) {
		
		instance= new Main();
		
		StartPanel d= new StartPanel();
		instance.show(d);
	}
}
