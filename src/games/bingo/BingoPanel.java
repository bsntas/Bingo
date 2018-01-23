package games.bingo;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.GridLayout;
import java.awt.Image;
import java.awt.Insets;
import java.awt.Toolkit;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;

import javax.swing.BorderFactory;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextPane;
import javax.swing.border.EtchedBorder;
import javax.swing.border.TitledBorder;
import javax.swing.text.Style;
import javax.swing.text.StyleConstants;

public class BingoPanel extends JPanel {
	private static final long serialVersionUID = 1L;
	private int[][] numarr;
	private JButton[][] numbuts= new JButton[5][5];
	private String[] playernames;
	private JTextPane score;
	private JLabel instruction;
	private JLabel[] playercomps;
	private static ImageIcon turnpointer;
	private static ImageIcon idlepointer;
	private ClientLogic gameLogic;
	
	public BingoPanel(int[][] arr, String[] players, ClientLogic logic) {
		super();
		numarr= arr;
		playernames= players;
		gameLogic= logic;
		setLayout(new BorderLayout());
		setName("BINGO");
		
		JPanel matrixPanel= new JPanel();
		GridLayout layout= new GridLayout(5,5,5,5);
		matrixPanel.setBorder(BorderFactory.createEtchedBorder(EtchedBorder.RAISED));
		matrixPanel.setLayout(layout);
		ActionListener l= new CommitListener();
		for (int i= 0; i < 5; i++)
			for (int j= 0; j < 5; j++) {
				numbuts[i][j]= new JButton(arr[i][j]+"");
				numbuts[i][j].addActionListener(l);
				numbuts[i][j].setFocusable(false);
				matrixPanel.add(numbuts[i][j]);
			}
		add(matrixPanel,BorderLayout.CENTER);
		
		score= new JTextPane();
		score.setText("BINGO");
		Style s= score.addStyle("remaining", null);
		s.addAttribute(StyleConstants.Alignment, StyleConstants.ALIGN_CENTER);
		s.addAttribute(StyleConstants.Bold, new Boolean(true));
		s.addAttribute(StyleConstants.FontSize, 25);
		s.addAttribute(StyleConstants.Foreground, Color.red);
		Style s1= score.addStyle("scored", s);
		s1.addAttribute(StyleConstants.Foreground, Color.green);
		score.setParagraphAttributes(s, true);
		score.setEditable(false);
		score.setFocusable(false);
		score.setFont(score.getFont().deriveFont(25f));
		score.setOpaque(false);
		add(score,BorderLayout.NORTH);
		
		instruction= new JLabel("Ready");
		instruction.setBorder(BorderFactory.createLoweredBevelBorder());
		add(instruction,BorderLayout.SOUTH);
		
		JPanel turnPanel= new JPanel(){
			private static final long serialVersionUID = 1L;
			public Dimension getPreferredSize() {
				Dimension supersize= super.getPreferredSize();
				JComponent parent= (JComponent) getParent();
				if(parent == null) return supersize;
				return new Dimension((int) (parent.getWidth()*0.30),supersize.height);
			}
		};
		turnPanel.setLayout(new FlowLayout(FlowLayout.CENTER));
		Image img= Toolkit.getDefaultToolkit().getImage("resources/turn.png").
				getScaledInstance(12, 14, Image.SCALE_SMOOTH);
		turnpointer= new ImageIcon(img);
		img= Toolkit.getDefaultToolkit().getImage("resources/idle.png").
				getScaledInstance(12, 12, Image.SCALE_SMOOTH);
		idlepointer= new ImageIcon(img);
		playercomps= new JLabel[playernames.length];
		for (int i= 0; i < playernames.length; i++) {
			playercomps[i]= new JLabel(playernames[i]) {
				private static final long serialVersionUID = 1L;
				public Dimension getPreferredSize() {
					Dimension supersize= super.getPreferredSize();
					JComponent parent= (JComponent) getParent();
					if(parent == null) return supersize;
					Insets insets= parent.getInsets();
					return new Dimension(parent.getWidth()-insets.left-insets.right-5, supersize.height);
				}
			};
			playercomps[i].setHorizontalAlignment(JLabel.LEFT);
			playercomps[i].setFont(getFont().deriveFont(16f));
			playercomps[i].setIcon(idlepointer);
			turnPanel.add(playercomps[i]);
		}
		turnPanel.setBorder(BorderFactory.createTitledBorder(BorderFactory.createEtchedBorder(), 
				"Turn", TitledBorder.CENTER, TitledBorder.TOP));
		add(turnPanel,BorderLayout.EAST);
	}
	
	public void commit (int num) {
		System.out.println ("Searching");
		for (int i= 0; i < 5; i++)
			for (int j= 0; j < 5; j++)
				if (numarr[i][j] == num) {
					System.out.println ("Committing here");
					numbuts[i][j].setEnabled(false);
					numbuts[i][j].setBackground(Color.green);
				}
		instruction.setText("Ready");
	}
	
	public void updateScore(int n) {
		if (n > 5) return;
		score.select(0, n);
		Style s= score.getStyle("scored");
		score.setCharacterAttributes(s, true);
		
	}
	
	public void setTurn (String player) {
		System.out.println ("Setting turn for " + player);
		for (int i= 0; i < playernames.length; i++)
			if (playernames[i].equals(player)) {
				playercomps[i].setIcon(turnpointer);
			} else {
				playercomps[i].setIcon(idlepointer);
			}
		repaint();
	}
	
	class CommitListener implements ActionListener {
		@Override
		public void actionPerformed(ActionEvent e) {
			JButton but= (JButton) e.getSource();
			int num= Integer.parseInt(but.getText());
			System.out.println ("I am commiting: " + num);
			BingoPanel panel= (BingoPanel) but.getParent().getParent();
			if(panel.gameLogic.commit(num))
				panel.instruction.setText("Sending your choice: " + num + ". Please wait");
			else panel.instruction.setText("Sorry, not your turn. Please wait...");
		}
	}
	
	public void setInstruction (String instr) {
		instruction.setText(instr);
	}
	
	JPanel getGameoverPanel (String myName, String winner) {
		JPanel gameoverPanel= new JPanel();
		gameoverPanel.setName("Bingo: bye bye");
		
		JTextPane tp= new JTextPane();
		String gameover= "Game Over\n";
		Style gover= tp.addStyle("gameover", null);
		StyleConstants.setFontSize(gover, 35);
		StyleConstants.setBold(gover, true);
		StyleConstants.setForeground(gover, Color.red);
		StyleConstants.setAlignment(gover, StyleConstants.ALIGN_CENTER);
		Style wnnr= tp.addStyle("winner", gover);
		StyleConstants.setForeground(wnnr, Color.BLUE);
		String winnernote= null;
		if (myName.equals(winner)) winnernote= "You Win";
		else winnernote= "Winner: " + winner;
		
		tp.setText(gameover + winnernote);
		
		tp.select(0, gameover.length());
		tp.setCharacterAttributes(gover, true);
		tp.select(gameover.length(), gameover.length()+winnernote.length());
		tp.setCharacterAttributes(wnnr, true);
		
		gameoverPanel.setLayout(new GridLayout(1,1));
		gameoverPanel.add(tp);
		return gameoverPanel;
	}
}
