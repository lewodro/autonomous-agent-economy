//! Offchain accounting demo. This is not a deployed Solana program.
const SOL: u64 = 1_000_000_000;
#[derive(Clone, Copy, Debug, PartialEq)]
enum Move {
    Rock,
    Paper,
    Scissors,
}
#[derive(Debug, PartialEq)]
enum Outcome {
    A,
    B,
    Draw,
}
fn resolve(a: Move, b: Move) -> Outcome {
    use Move::*;
    if a == b {
        Outcome::Draw
    } else if matches!((a, b), (Rock, Scissors) | (Paper, Rock) | (Scissors, Paper)) {
        Outcome::A
    } else {
        Outcome::B
    }
}
#[derive(Clone, Debug)]
struct Agent {
    balance: u64,
    reserve: u64,
    max_stake: u64,
    max_loss: u64,
    pnl: i64,
}
impl Agent {
    fn authorize(&self, stake: u64) -> Result<(), &'static str> {
        if stake == 0 || stake > self.max_stake {
            return Err("stake limit");
        }
        if self
            .balance
            .checked_sub(stake)
            .ok_or("insufficient funds")?
            < self.reserve
        {
            return Err("reserve protected");
        }
        let stake_signed = i64::try_from(stake).map_err(|_| "stake overflow")?;
        let max_loss = i64::try_from(self.max_loss).map_err(|_| "loss overflow")?;
        if self.pnl.checked_sub(stake_signed).ok_or("pnl overflow")? < -max_loss {
            return Err("loss limit");
        }
        Ok(())
    }
}
#[derive(Default)]
struct Settlement {
    settled: bool,
}
fn settle(
    record: &mut Settlement,
    a: &mut Agent,
    b: &mut Agent,
    stake: u64,
    result: Outcome,
) -> Result<(), &'static str> {
    if record.settled {
        return Ok(());
    }
    a.authorize(stake)?;
    b.authorize(stake)?;
    let pot = stake.checked_mul(2).ok_or("pot overflow")?;
    let payout = match result {
        Outcome::A => [pot, 0],
        Outcome::B => [0, pot],
        Outcome::Draw => [stake, stake],
    };
    let mut next = [a.clone(), b.clone()];
    for i in 0..2 {
        next[i].balance = next[i]
            .balance
            .checked_sub(stake)
            .and_then(|v| v.checked_add(payout[i]))
            .ok_or("balance overflow")?;
        let delta = i64::try_from(payout[i]).map_err(|_| "payout overflow")?
            - i64::try_from(stake).map_err(|_| "stake overflow")?;
        next[i].pnl = next[i].pnl.checked_add(delta).ok_or("pnl overflow")?;
    }
    *a = next[0].clone();
    *b = next[1].clone();
    record.settled = true;
    Ok(())
}
fn main() {
    println!(
        "Rules: {:?}, {:?}, {:?}",
        Move::Rock,
        Move::Paper,
        Move::Scissors
    );
    let mut a = Agent {
        balance: SOL,
        reserve: SOL / 10,
        max_stake: SOL / 10,
        max_loss: SOL / 2,
        pnl: 0,
    };
    let mut b = a.clone();
    let mut receipt = Settlement::default();
    let stake = 30_000_000;
    settle(
        &mut receipt,
        &mut a,
        &mut b,
        stake,
        resolve(Move::Rock, Move::Scissors),
    )
    .unwrap();
    settle(&mut receipt, &mut a, &mut b, stake, Outcome::A).unwrap();
    assert_eq!(a.balance + b.balance, SOL * 2);
    println!("Offline Rust settlement: rock beats scissors; A={} lamports, B={} lamports; capital conserved; duplicate payout prevented.", a.balance,b.balance);
    println!("Future Solana adapter must additionally verify signer ownership, escrow accounts, commitment proofs, fees, and receipt finality. This demo performs no blockchain transaction.");
}
#[cfg(test)]
mod tests {
    use super::*;
    fn agent() -> Agent {
        Agent {
            balance: SOL,
            reserve: SOL / 10,
            max_stake: SOL / 10,
            max_loss: SOL / 2,
            pnl: 0,
        }
    }
    #[test]
    fn all_outcomes() {
        use Move::*;
        let moves = [Rock, Paper, Scissors];
        for a in moves {
            for b in moves {
                if a == b {
                    assert_eq!(resolve(a, b), Outcome::Draw);
                } else {
                    assert_ne!(resolve(a, b), resolve(b, a));
                }
            }
        }
    }
    #[test]
    fn settlement_once() {
        let mut a = agent();
        let mut b = agent();
        let mut receipt = Settlement::default();
        settle(&mut receipt, &mut a, &mut b, 30_000_000, Outcome::A).unwrap();
        settle(&mut receipt, &mut a, &mut b, 30_000_000, Outcome::A).unwrap();
        assert_eq!(a.balance, 1_030_000_000);
        assert_eq!(b.balance, 970_000_000);
    }
    #[test]
    fn invalid_second_entry_is_atomic() {
        let mut a = agent();
        let mut b = agent();
        b.max_stake = 1;
        assert!(settle(
            &mut Settlement::default(),
            &mut a,
            &mut b,
            30_000_000,
            Outcome::A
        )
        .is_err());
        assert_eq!(a.balance, SOL);
        assert_eq!(b.balance, SOL);
    }
    #[test]
    fn limits() {
        let mut a = agent();
        assert!(a.authorize(0).is_err());
        assert!(a.authorize(SOL).is_err());
        a.reserve = SOL;
        assert!(a.authorize(30_000_000).is_err());
        a.reserve = 0;
        a.pnl = -490_000_000;
        assert!(a.authorize(30_000_000).is_err());
    }
}
