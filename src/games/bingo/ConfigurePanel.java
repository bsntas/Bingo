package games.bingo;

import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Insets;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.util.ArrayList;

import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.border.TitledBorder;

public class ConfigurePanel extends JPanel {
	private static final long serialVersionUID = 1L;
	private JPanel playerNamePanel;
	private JButton startButton;
	private ArrayList<String> playerNames;
	private ClientLogic logic;
	
	public String[] getPlayerNames() {
		String[] names= new String[playerNames.size()];
		for (int i= 0; i < playerNames.size(); i++)
			names[i]= playerNames.get(i);
		return names;
	}

	public ConfigurePanel(ClientLogic clientLogic) {
		super();
		logic= clientLogic;
		playerNames= new ArrayList<String>();
		setLayout(new BorderLayout());
		playerNamePanel= new JPanel();
		playerNamePanel.setLayout(new FlowLayout(FlowLayout.CENTER));
		playerNamePanel.setBorder(BorderFactory.createTitledBorder(BorderFactory.createRaisedBevelBorder(),
				"Players' List", TitledBorder.CENTER, TitledBorder.TOP));
		add(playerNamePanel,BorderLayout.CENTER);
		
		JPanel buts= new JPanel();
		((FlowLayout)buts.getLayout()).setAlignment(FlowLayout.RIGHT);
		startButton= new JButton("Start Game");
		startButton.addActionListener(new StartGameListener());
		
		startButton.setEnabled(false);
		buts.add(startButton);
		add(buts,BorderLayout.SOUTH);
		setName("Bingo: Waiting for players");
	}
	
	public void addPlayer (String s) {
		for (String player: playerNames)
			if (player.equals(s)) return;
		playerNames.add(s);
		
		JLabel player= new JLabel(s) {
			private static final long serialVersionUID = 1L;
			public Dimension getPreferredSize() {
				Dimension dim= super.getPreferredSize();
				JComponent parent= (JComponent) playerNamePanel.getParent();
				if (parent == null) return dim;
				Insets insets= parent.getInsets();
				return new Dimension(parent.getWidth()-insets.left-insets.right-10,dim.height);
			}
		};
		player.setFont(getFont().deriveFont(20f));
		player.setBorder(BorderFactory.createLoweredBevelBorder());
		player.setName(s);
		playerNamePanel.add(player);
		playerNamePanel.revalidate();
		playerNamePanel.repaint();
	}
	
	public void removePlayer(String s) {
		if(!playerNames.remove(s)) return;
		Component[] comps= playerNamePanel.getComponents();
		for (Component comp: comps)
			if (comp.getName().equals(s)) {
				playerNamePanel.remove(comp);
				playerNamePanel.revalidate();
				playerNamePanel.repaint();
				return;
			}
	}
	
	public void setHost () {
		startButton.setEnabled(true);
	}
	
	class StartGameListener implements ActionListener {
		@Override
		public void actionPerformed(ActionEvent e) {
			logic.sendStartGameMessage();
		}
	}
}
