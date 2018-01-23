package games.bingo;

import java.util.PrimitiveIterator.OfInt;
import java.util.Random;
import java.util.stream.IntStream;

public class Generator {
	
	private OfInt iterator;
	
	public Generator() {
		Random r= new Random();
		IntStream stream= r.ints(1, 26);
		iterator= stream.iterator();
	}
	
	public int[][] getNewKit() {
		int[][] arr= new int[5][5];
		int i=0, j= 0;
		boolean found= false;
		for (;j < 5;) {
			int el= iterator.nextInt();
			FIRST: for (int k= 0; k < 5; k++)
				for (int l= 0; l < 5; l++)
					if (arr[k][l] == el) {
						found= true;
						break FIRST;
					}
			if (!found) {
				arr[i][j]= el;
				i++;
				if (i == 5) {
					i= 0;
					j++;
				}
			}
			found= false;
		}
		return arr;
	}
	
	/*public static void main(String[] args) {
		Generator gen= new Generator();
		for (int i= 0; i < 5; i++) {
			int[][] kit= gen.getNewKit();
			for (int j= 0; j < 5; j++) {
				for (int k= 0; k < 5; k++)
					System.out.print(kit[j][k] + " ");
				System.out.println();
			}
			System.out.println ("\n\n");
		}
	}*/
}
