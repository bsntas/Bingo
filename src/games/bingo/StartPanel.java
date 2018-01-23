package games.bingo;

import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.GridLayout;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;

import javax.swing.ButtonGroup;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JRadioButton;
import javax.swing.JTextField;


public class StartPanel extends JPanel {
	private static final long serialVersionUID = 1L;
	private String player;
	private Role role;
	private String remotehost;
	
	private JRadioButton hostselector;
	private JRadioButton remoteselector;
	private JTextField hostinput;
	private JTextField playerinput;
	private JLabel message;

	public String getPlayerName() {
		return player;
	}

	public Role getRole() {
		return role;
	}
	
	public String getRemotehost() {
		return remotehost;
	}

	public StartPanel() {
		super();
		setLayout(new BorderLayout());
		setName("Welcome to Bingo");
		
		JPanel panel= new JPanel() {
			private static final long serialVersionUID = 1L;
			@Override
			public Dimension getPreferredSize() {
				JComponent parent= (JComponent) this.getParent();
				return new Dimension(parent.getWidth() - 10, super.getPreferredSize().height);
			}
		};
		panel.setLayout(new GridLayout(4,1));
		
		JPanel player= new JPanel();
		player.setLayout(new BorderLayout());
		JLabel playerlabel= new JLabel("Player");
		player.add(playerlabel,BorderLayout.WEST);
		playerinput= new JTextField();
		player.add(playerinput);
		panel.add(player);
		
		ButtonGroup group= new ButtonGroup();
		hostselector= new JRadioButton();
		hostselector.addActionListener(new RadioActionListener());
		hostselector.setSelected(false);
		remoteselector= new JRadioButton();
		remoteselector.addActionListener(new RadioActionListener());
		remoteselector.setSelected(true);
		group.add(hostselector);
		group.add(remoteselector);
		
		JPanel hoister= new JPanel();
		hoister.setLayout(new BorderLayout());
		hoister.add(hostselector,BorderLayout.WEST);
		JLabel hoistmessage= new JLabel("Host the game myself");
		hoister.add(hoistmessage);
		panel.add(hoister);
		
		JPanel remote= new JPanel();
		remote.setLayout(new BorderLayout());
		remote.add(remoteselector,BorderLayout.WEST);
		JLabel remotemessage= new JLabel("Connect to remote host");
		remote.add(remotemessage);
		panel.add(remote);
		
		JPanel host= new JPanel();
		host.setLayout(new BorderLayout());
		JLabel askhost= new JLabel("Remote Host");
		host.add(askhost,BorderLayout.WEST);
		hostinput= new JTextField();
		hostinput.setText("192.168.34.");
		host.add(hostinput);
		panel.add(host);
		
		JPanel buttonpanel= new JPanel();
		buttonpanel.setLayout(new BorderLayout());
		JButton cont= new JButton("Continue");
		cont.addActionListener(new ContinueListener());
		message= new JLabel();
		message.setText("Player name is compulsory");
		buttonpanel.add(message);
		buttonpanel.add(cont,BorderLayout.EAST);
		
		JPanel dummy= new JPanel();
		dummy.add(panel);
		add(dummy);
		add(buttonpanel,BorderLayout.SOUTH);
		role= Role.PARASITE;
	}

	class ContinueListener implements ActionListener {
		
		private boolean inputsGiven () {
			String s= playerinput.getText();
			if (s.isEmpty()) {
				playerinput.requestFocus();
				message.setText("Player name cannot be empty");
				return false;
			}
			if (role.equals(Role.PARASITE)) {
				s= hostinput.getText();
				if (s.isEmpty()) {
					hostinput.requestFocus();
					message.setText("Mention the remote host address");
					return false;
				}
			}
			return true;
		}
		
		@Override
		public void actionPerformed(ActionEvent e) {
			if (!inputsGiven()) return;
			
			message.setText("Please wait...");
			player= playerinput.getText();
			
			if (role.equals(Role.PARASITE)) {
				remotehost= hostinput.getText();
			} else {
				try {
					remotehost= InetAddress.getLocalHost().getHostAddress();
				} catch (UnknownHostException e1) {
					remotehost= InetAddress.getLoopbackAddress().getHostAddress();
				}
				Main.instance.startServer();
				try { Thread.sleep(100);} catch (Exception e1) { }
			}
			// start the client logic
			ClientLogic cl= new ClientLogic(player);
			Communicator com= null;
			try {
				com= new Communicator(remotehost);
			} catch (IOException e1) {
				message.setText(/*"Sorry! Could not connect to server. Try again." +*/ e1.getMessage());
				return;
			}
			cl.setCommunicator(com);	// relate client to communicator
			com.setLogic(cl);			// relate communicator to client
			StartPanel p= (StartPanel) ((JComponent)e.getSource()).getParent().getParent();
			Main.instance.setClientLogicRefernce(cl);
			cl.takeOver(p);
		}
	}
	
	class RadioActionListener implements ActionListener {
		@Override
		public void actionPerformed(ActionEvent e) {
			JRadioButton but= (JRadioButton) e.getSource();
			if (but.equals(hostselector)) {
				hostinput.setEnabled(false);
				role= Role.HOST;
			} else {
				hostinput.setEnabled(true);
				role= Role.PARASITE;
			}
		}
	}
}

enum Role {
	HOST, PARASITE;
}